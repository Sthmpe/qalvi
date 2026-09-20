"""Opt-in development diagnostics. Never log participant text or credentials."""

import json
import logging
import os
import sys
import time

logger = logging.getLogger("qalvi.latency")


def install_latency_logging(session, *, room_name, stt, llm, tts):
    if not (
        os.getenv("QALVI_ENV") == "development"
        or any(command in sys.argv[1:] for command in ("dev", "console"))
    ):
        return

    began = time.perf_counter()

    def emit(stage, **fields):
        logger.info("[qalvi latency] %s", json.dumps({
            "stage": stage,
            "room": room_name,
            "at_ms": round(time.time() * 1000),
            "session_ms": round((time.perf_counter() - began) * 1000),
            **fields,
        }))

    @session.on("user_state_changed")
    def on_user_state(event):
        if event.old_state == "speaking" and event.new_state != "speaking":
            emit("user_speech_end_detected", detected_at_ms=round(event.created_at * 1000))

    @session.on("user_input_transcribed")
    def on_transcript(event):
        if event.is_final:
            emit("stt_final", item_id=event.item_id,
                 received_at_ms=round(event.created_at * 1000))

    def on_component_metrics(metric):
        fields = {"request_id": metric.request_id,
                  "speech_id": getattr(metric, "speech_id", None)}
        for name in ("duration", "ttft", "ttfb"):
            value = getattr(metric, name, None)
            if value is not None and value >= 0:
                fields[name + "_ms"] = round(value * 1000)
        emit(metric.type, **fields)

    for plugin in (stt, llm, tts):
        plugin.on("metrics_collected", on_component_metrics)

    @session.on("conversation_item_added")
    def on_item(event):
        item = event.item
        fields = {"item_id": item.id, "role": item.role}
        # SDK timings are measured inside the pipeline, not inferred from UI state.
        for name in (
            "started_speaking_at", "stopped_speaking_at", "transcription_delay",
            "end_of_turn_delay", "llm_node_ttft", "llm_node_ttfs",
            "tts_node_ttfb", "playback_latency", "e2e_latency",
        ):
            value = item.metrics.get(name)
            if value is not None:
                fields[name + "_ms"] = round(value * 1000)
        fields["provider_request_ids"] = item.metrics.get("provider_request_ids", [])
        emit("turn_metrics", **fields)

    emit("enabled")
