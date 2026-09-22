"""One opening request per agent session, never a participant wake-up message."""


class OpeningTurn:
    def __init__(self):
        self.started = False

    async def start(self, session, wait_for_participant) -> bool:
        if self.started:
            return True
        # Claim before awaiting: participant/reconnection callbacks cannot race it.
        self.started = True
        participant = await wait_for_participant()
        if participant.attributes.get("qalvi.resume") == "true":
            # This is a replacement job, not the original in-memory conversation.
            # Do not invent continuity or replay the greeting without its context.
            return False
        await session.generate_reply(
            instructions="Greet the participant briefly and ask your first research question."
        )
        return True
