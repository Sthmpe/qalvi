"""Typed participant turn gate shared by the LiveKit callback and focused tests."""

import json
from datetime import datetime, timezone

from persistence import EVENT_ID, EvidenceError, occurred_at

EVIDENCE_TOPIC = "qalvi.evidence"


async def handle_text_input(sess, event, agent, writer, room, real_identity):
    async with sess._claim_user_turn():
        if writer:
            if agent._paused or not event.info or not event.participant or \
                    event.participant.identity != real_identity or not event.text.strip():
                return
            supplied_id = event.info.attributes.get("qalvi.event_id") if event.info.attributes else None
            event_id = supplied_id if supplied_id and EVENT_ID.fullmatch(supplied_id) else event.info.stream_id
            if event.text.startswith("[On screen]"):
                await room.local_participant.send_text(
                    json.dumps({"eventId": event_id, "status": "failed"}), topic=EVIDENCE_TOPIC)
                return  # visual evidence belongs to the later atomic visual-response path
            stamped_at = event.info.attributes.get("qalvi.event_at") if event.info.attributes else None
            try:
                when = datetime.fromisoformat(stamped_at) if stamped_at else None
                if when is not None and (when.tzinfo is None or
                                         abs((datetime.now(timezone.utc) - when).total_seconds()) > 86400):
                    stamped_at = None
            except (TypeError, ValueError):
                stamped_at = None
            key = "text:" + event_id
            try:
                if key not in agent._advanced_turns:
                    await sess.interrupt()
                    await agent.flush_assistant()
                saved = await writer.append(key, "participant", "text", event.text,
                                            stamped_at or occurred_at(event.info.timestamp / 1000))
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
                marker("text", saved.sequence)
        else:
            await sess.interrupt()
        guidance = await agent.present(event.text)
        if guidance:
            sess.generate_reply(user_input=event.text, instructions=guidance)
        else:
            sess.generate_reply(user_input=event.text)
