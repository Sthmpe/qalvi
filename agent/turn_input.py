"""Typed participant turn gate shared by the LiveKit callback and focused tests."""

import json
from datetime import datetime, timezone

from persistence import EVENT_ID, EvidenceError, occurred_at
from visuals import RESPONSE_PREFIX, describe_answer

EVIDENCE_TOPIC = "qalvi.evidence"


def _visual_answer(agent, attributes: dict) -> tuple[str, str, list[str], float | None] | None:
    conductor = getattr(agent, "_conductor", None)
    display = conductor.on_screen.display if conductor and conductor.pending_visual() else None
    if display is None:
        return None
    try:
        response = json.loads(attributes.get("qalvi.visual", ""))
    except (TypeError, ValueError):
        return None
    described = describe_answer(display, response)
    return (display["id"], *described) if described else None


async def handle_text_input(sess, event, agent, writer, room, real_identity):
    # A typed stream and a completed voice turn may arrive concurrently. The
    # SDK's _claim_user_turn tracks activity but is not a mutual exclusion lock.
    lock = getattr(agent, "_turn_lock", None) if writer else None
    if lock:
        async with lock:
            return await _handle_claimed_text_input(sess, event, agent, writer, room, real_identity)
    return await _handle_claimed_text_input(sess, event, agent, writer, room, real_identity)


async def _handle_claimed_text_input(sess, event, agent, writer, room, real_identity):
    async with sess._claim_user_turn():
        if writer:
            if agent._paused or not event.info or not event.participant or \
                    event.participant.identity != real_identity or not event.text.strip():
                return
            supplied_id = event.info.attributes.get("qalvi.event_id") if event.info.attributes else None
            event_id = supplied_id if supplied_id and EVENT_ID.fullmatch(supplied_id) else event.info.stream_id
            visual = None
            if event.text.startswith(RESPONSE_PREFIX):
                # Never trust the browser's wording: rebuild the answer from the visual
                # this agent actually displayed, or refuse it.
                visual = _visual_answer(agent, event.info.attributes or {})
                if visual is None:
                    await room.local_participant.send_text(
                        json.dumps({"eventId": event_id, "status": "failed"}), topic=EVIDENCE_TOPIC)
                    return
            stamped_at = event.info.attributes.get("qalvi.event_at") if event.info.attributes else None
            try:
                when = datetime.fromisoformat(stamped_at) if stamped_at else None
                if when is not None and (when.tzinfo is None or
                                         abs((datetime.now(timezone.utc) - when).total_seconds()) > 86400):
                    stamped_at = None
            except (TypeError, ValueError):
                stamped_at = None
            key = ("visual:" if visual else "text:") + event_id
            when_text = stamped_at or occurred_at(event.info.timestamp / 1000)
            try:
                if key not in agent._advanced_turns:
                    await sess.interrupt()
                    await agent.flush_assistant()
                if visual:
                    action_id, content, option_ids, numeric = visual
                    await writer.acknowledge_visual(action_id)  # an answer proves it was rendered
                    saved = await writer.append_visual_answer(key, action_id, content, when_text, option_ids, numeric)
                    turn_text = f"{RESPONSE_PREFIX} {content}"
                else:
                    saved = await writer.append(key, "participant", "text", event.text, when_text)
                    turn_text = event.text
            except EvidenceError:
                await agent.pause_evidence()
                try:
                    await room.local_participant.send_text(
                        json.dumps({"eventId": event_id, "status": "failed"}), topic=EVIDENCE_TOPIC)
                except Exception:
                    pass
                return
            try:
                await room.local_participant.send_text(json.dumps({
                    "eventId": event_id, "status": "saved", "messageId": saved.id,
                    "sequence": saved.sequence,
                }), topic=EVIDENCE_TOPIC)
            except Exception:
                pass  # the database committed; a retry with the same event ID gets the same row
            if not saved.inserted or key in agent._advanced_turns:
                return
            agent._advanced_turns.add(key)
            marker = getattr(agent, "mark_evidence_ack", None)
            if marker:
                marker("visual" if visual else "text", saved.sequence)
        else:
            await sess.interrupt()
            turn_text = event.text
        try:
            guidance = await agent.present(turn_text, saved if writer else None)
        except EvidenceError:
            await agent.pause_evidence()
            return
        if guidance:
            sess.generate_reply(user_input=turn_text, instructions=guidance)
        else:
            sess.generate_reply(user_input=turn_text)
