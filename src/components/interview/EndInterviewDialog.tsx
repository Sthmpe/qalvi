"use client";

import { useEffect, useRef, useState } from "react";

export default function EndInterviewDialog({ ending, onEnd }: {
  ending: boolean; onEnd: () => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (open) { wasOpen.current = true; dialog.current?.showModal(); cancel.current?.focus(); }
    else if (wasOpen.current) {
      dialog.current?.close(); trigger.current?.focus(); wasOpen.current = false;
    }
  }, [open]);
  useEffect(() => { if (open && ending) dialog.current?.focus(); }, [open, ending]);

  return <>
    <button ref={trigger} type="button" className="interview-end" onClick={() => { setFailed(false); setOpen(true); }}>End interview</button>
    <dialog ref={dialog} tabIndex={-1} aria-busy={ending} className="interview-end-dialog" aria-labelledby="end-title" aria-describedby="end-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!ending) setOpen(false);
          return;
        }
        if (event.key !== "Tab") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = buttons[0], last = buttons.at(-1);
        if (!first) { event.preventDefault(); event.currentTarget.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); if (!ending) setOpen(false); }}>
      <h2 id="end-title">Ready to finish?</h2>
      <p id="end-description">Your saved conversation will stay available. You will not be able to add more answers after ending this interview.</p>
      {failed && <p role="alert">The ending could not be confirmed. Please try again.</p>}
      <div className="interview-dialog-actions">
        <button ref={cancel} type="button" disabled={ending} onClick={() => setOpen(false)}>Keep talking</button>
        <button type="button" disabled={ending} onClick={async () => {
          setFailed(false);
          if (await onEnd()) setOpen(false); else setFailed(true);
        }}>{ending ? "Ending interview…" : "End interview"}</button>
      </div>
    </dialog>
  </>;
}
