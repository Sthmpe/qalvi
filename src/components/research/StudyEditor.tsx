"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Badge, Button, ButtonLink, Card, PageHeading } from "@/components/ui/primitives";
import type { DisplayAction } from "@/components/interview/visuals/display";
import { saveStudy } from "@/lib/studies/actions";
import { templates } from "@/lib/research/templates";
import {
  EDITABLE_STATUSES,
  LIMITS,
  STATUS_LABEL,
  VISUAL_LABEL,
  newObjectiveId,
  readinessGaps,
  visualId,
  type ObjectivePriority,
  type SetupErrors,
  type Study,
  type StudyStatus,
  type VisualType,
} from "@/lib/studies/setup";

type OptionDraft = { label: string; description: string };
type BarDraft = { label: string; value: string };
type VisualDraft = {
  type: VisualType;
  prompt: string;
  options: OptionDraft[];
  multiple: boolean;
  bars: BarDraft[];
  min: string;
  max: string;
  step: string;
  initial: string;
  unit: string;
  minLabel: string;
  maxLabel: string;
};
type ObjectiveDraft = { id: string; topic: string; priority: ObjectivePriority; visual: VisualDraft | null };

const blankVisual = (type: VisualType): VisualDraft => ({
  type,
  prompt: "",
  options: [{ label: "", description: "" }, { label: "", description: "" }],
  multiple: true,
  bars: [{ label: "", value: "" }, { label: "", value: "" }],
  min: "0",
  max: "100",
  step: "5",
  initial: "50",
  unit: "",
  minLabel: "",
  maxLabel: "",
});

function draftFromVisual(visual: DisplayAction | null): VisualDraft | null {
  if (!visual) return null;
  const draft = blankVisual(visual.type);
  draft.prompt = visual.prompt;
  if (visual.type === "comparison_cards" || visual.type === "multiple_choice") {
    draft.options = visual.options.map((option) => ({ label: option.label, description: option.description ?? "" }));
    draft.multiple = visual.type === "multiple_choice" ? Boolean(visual.multiple) : true;
  } else if (visual.type === "bar_chart") {
    draft.bars = visual.bars.map((bar) => ({ label: bar.label, value: String(bar.value) }));
    draft.unit = visual.unit ?? "";
  } else {
    Object.assign(draft, {
      min: String(visual.min), max: String(visual.max), step: String(visual.step), initial: String(visual.initial),
      unit: visual.unit ?? "", minLabel: visual.minLabel ?? "", maxLabel: visual.maxLabel ?? "",
    });
  }
  return draft;
}

/** Turn the editor's text fields into a display action. The server validates it; nothing here is trusted. */
function visualFromDraft(objectiveId: string, draft: VisualDraft) {
  const base = { id: visualId(objectiveId), prompt: draft.prompt.trim() };
  const optional = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {});
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));
  switch (draft.type) {
    case "comparison_cards":
      return {
        type: draft.type, ...base,
        options: draft.options.map((option, index) => ({
          id: `o${index + 1}`, label: option.label.trim(), description: option.description.trim(),
        })),
      };
    case "multiple_choice":
      return {
        type: draft.type, ...base, multiple: draft.multiple,
        options: draft.options.map((option, index) => ({ id: `o${index + 1}`, label: option.label.trim() })),
      };
    case "bar_chart":
      return {
        type: draft.type, ...base, ...optional("unit", draft.unit),
        bars: draft.bars.map((bar, index) => ({ id: `b${index + 1}`, label: bar.label.trim(), value: number(bar.value) })),
      };
    case "slider":
      return {
        type: draft.type, ...base,
        min: number(draft.min), max: number(draft.max), step: number(draft.step), initial: number(draft.initial),
        ...optional("unit", draft.unit), ...optional("minLabel", draft.minLabel), ...optional("maxLabel", draft.maxLabel),
      };
  }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="field-error" role="alert">{message}</p> : null;
}

export default function StudyEditor({ study, templateId }: { study?: Study; templateId?: string }) {
  const router = useRouter();
  const formId = useId();
  const template = templates.find((item) => item.id === templateId) ?? templates[0];
  const [title, setTitle] = useState(study?.title ?? "");
  const [description, setDescription] = useState(study?.description ?? "");
  const [category, setCategory] = useState(study?.category ?? template.name);
  const [researchGoal, setResearchGoal] = useState(study?.researchGoal ?? template.goal);
  const [audience, setAudience] = useState(study?.audience ?? "");
  const [status, setStatus] = useState<StudyStatus>(study?.status ?? "draft");
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>(() =>
    study?.objectives.length
      ? study.objectives.map((item) => ({ ...item, visual: draftFromVisual(item.visual) }))
      : [{ id: newObjectiveId(), topic: "", priority: "high", visual: null }],
  );
  const [assumptions, setAssumptions] = useState<string[]>(study?.assumptions.length ? study.assumptions : [""]);
  const [errors, setErrors] = useState<SetupErrors>({});
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const summary = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message && !saved) summary.current?.focus();
  }, [message, saved]);

  const touched = () => setSaved(false);
  const updateObjective = (id: string, change: Partial<ObjectiveDraft>) => {
    touched();
    setObjectives((items) => items.map((item) => (item.id === id ? { ...item, ...change } : item)));
  };
  const updateVisual = (id: string, change: Partial<VisualDraft>) => {
    touched();
    setObjectives((items) => items.map((item) =>
      item.id === id && item.visual ? { ...item, visual: { ...item.visual, ...change } } : item));
  };
  const move = (index: number, by: number) => {
    touched();
    setObjectives((items) => {
      const next = [...items];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  };

  const objectivesWithTopics = objectives.filter((item) => item.topic.trim());
  const gaps = readinessGaps({ researchGoal, audience, objectives: objectivesWithTopics.map((item) => ({ ...item, visual: null })) });

  function submit() {
    const input = {
      title, description, researchGoal, audience, category, status, assumptions,
      objectives: objectives
        .filter((item) => item.topic.trim() || item.visual)
        .map((item) => ({
          id: item.id, topic: item.topic, priority: item.priority,
          visual: item.visual ? visualFromDraft(item.id, item.visual) : null,
        })),
    };
    setMessage("");
    startTransition(async () => {
      const result = await saveStudy(study?.id ?? null, input);
      if (result.ok) {
        setErrors({});
        if (!study) {
          router.push(`/studies/${result.id}`);
          return;
        }
        setSaved(true);
        setMessage("Saved. New interviews will follow this setup.");
        router.refresh();
      } else {
        setErrors(result.errors);
        setMessage(result.message ?? "The study could not be saved.");
      }
    });
  }

  const err = (key: keyof SetupErrors) => (typeof errors[key] === "string" ? (errors[key] as string) : undefined);
  const describedBy = (key: string, has?: string) => (has ? `${formId}-${key}-error` : undefined);

  return (
    <>
      {!study && (
        <PageHeading
          eyebrow="A GOOD STUDY STARTS WITH A QUESTION"
          title="What are you curious about?"
          description="Shape the study Qalvi will follow in every conversation. Save it as a draft, then make it active when you are ready to invite people."
        />
      )}
      <div className="draft-layout">
        <form
          className="study-editor"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Card className="draft-form editor-section">
            <span className="q-eyebrow">01 · THE QUESTION</span>
            <h2>Give your research direction</h2>
            {!study && (
              <label>
                Starting point
                <select
                  value={templates.find((item) => item.name === category)?.id ?? ""}
                  onChange={(event) => {
                    const next = templates.find((item) => item.id === event.target.value);
                    if (!next) return;
                    touched();
                    setCategory(next.name);
                    setResearchGoal(next.goal);
                  }}
                >
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Study name
              <input
                required
                maxLength={LIMITS.title}
                placeholder="e.g. Understanding our customers’ first week"
                value={title}
                aria-invalid={Boolean(err("title"))}
                aria-describedby={describedBy("title", err("title"))}
                onChange={(event) => { touched(); setTitle(event.target.value); }}
              />
              <FieldError id={`${formId}-title-error`} message={err("title")} />
            </label>
            <label>
              Short summary <span className="optional">Optional · shown to participants before they agree</span>
              <textarea
                rows={2}
                maxLength={LIMITS.description}
                placeholder="A sentence a participant will read on the invitation."
                value={description}
                onChange={(event) => { touched(); setDescription(event.target.value); }}
              />
              <FieldError id={`${formId}-description-error`} message={err("description")} />
            </label>
            <label>
              What do you want to learn?
              <textarea
                rows={4}
                maxLength={LIMITS.researchGoal}
                value={researchGoal}
                aria-invalid={Boolean(err("researchGoal"))}
                aria-describedby={describedBy("researchGoal", err("researchGoal"))}
                onChange={(event) => { touched(); setResearchGoal(event.target.value); }}
              />
              <FieldError id={`${formId}-researchGoal-error`} message={err("researchGoal")} />
            </label>
            <label>
              Who would you like to hear from?
              <input
                maxLength={LIMITS.audience}
                placeholder="e.g. Customers who joined in the last month"
                value={audience}
                aria-invalid={Boolean(err("audience"))}
                aria-describedby={describedBy("audience", err("audience"))}
                onChange={(event) => { touched(); setAudience(event.target.value); }}
              />
              <FieldError id={`${formId}-audience-error`} message={err("audience")} />
            </label>
          </Card>

          <Card className="draft-form editor-section">
            <span className="q-eyebrow">02 · WHAT EACH CONVERSATION SHOULD COVER</span>
            <h2>Interview objectives</h2>
            <p className="editor-hint">
              Qalvi pursues these in order, follows the participant when they lead somewhere useful, and
              never asks again about something already answered. Essential objectives survive when a
              participant is short on time.
            </p>
            <FieldError id={`${formId}-objectives-error`} message={err("objectives")} />
            <ol className="objective-list">
              {objectives.map((item, index) => {
                const problem = errors.objective?.[item.id];
                return (
                  <li key={item.id} className="objective-item">
                    <div className="objective-head">
                      <span className="objective-number">{String(index + 1).padStart(2, "0")}</span>
                      <div className="objective-tools">
                        <button type="button" className="icon-button" aria-label={`Move objective ${index + 1} up`}
                          disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                        <button type="button" className="icon-button" aria-label={`Move objective ${index + 1} down`}
                          disabled={index === objectives.length - 1} onClick={() => move(index, 1)}>↓</button>
                        <button type="button" className="icon-button" aria-label={`Remove objective ${index + 1}`}
                          disabled={objectives.length === 1 && !item.topic && !item.visual}
                          onClick={() => {
                            touched();
                            setObjectives((items) => items.length > 1
                              ? items.filter((other) => other.id !== item.id)
                              : [{ id: newObjectiveId(), topic: "", priority: "high", visual: null }]);
                          }}>×</button>
                      </div>
                    </div>
                    <label>
                      <span className="sr-only">Objective {index + 1}</span>
                      <textarea
                        rows={2}
                        maxLength={LIMITS.objectiveTopic}
                        placeholder="e.g. The last time they tried to solve this, and what they used"
                        value={item.topic}
                        aria-invalid={Boolean(problem)}
                        aria-describedby={problem ? `${formId}-${item.id}-error` : undefined}
                        onChange={(event) => updateObjective(item.id, { topic: event.target.value })}
                      />
                    </label>
                    <div className="objective-options">
                      <div className="segmented" role="radiogroup" aria-label={`Priority of objective ${index + 1}`}>
                        {(["high", "low"] as const).map((priority) => (
                          <button key={priority} type="button" role="radio" aria-checked={item.priority === priority}
                            onClick={() => updateObjective(item.id, { priority })}>
                            {priority === "high" ? "Essential" : "Nice to have"}
                          </button>
                        ))}
                      </div>
                      <label className="inline-select">
                        On-screen visual
                        <select
                          value={item.visual?.type ?? ""}
                          onChange={(event) => updateObjective(item.id, {
                            visual: event.target.value ? blankVisual(event.target.value as VisualType) : null,
                          })}
                        >
                          <option value="">None, conversation only</option>
                          {(Object.keys(VISUAL_LABEL) as VisualType[]).map((type) => (
                            <option key={type} value={type}>{VISUAL_LABEL[type]}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {item.visual && (
                      <VisualFields draft={item.visual} index={index} onChange={(change) => updateVisual(item.id, change)} />
                    )}
                    <FieldError id={`${formId}-${item.id}-error`} message={problem} />
                  </li>
                );
              })}
            </ol>
            <Button
              variant="secondary"
              disabled={objectives.length >= LIMITS.objectives}
              onClick={() => {
                touched();
                setObjectives((items) => [...items, {
                  id: newObjectiveId(items.map((other) => other.id)), topic: "", priority: "high", visual: null,
                }]);
              }}
            >
              ＋ Add objective
            </Button>
          </Card>

          <Card className="draft-form editor-section">
            <span className="q-eyebrow">03 · WHAT YOU BELIEVE TODAY</span>
            <h2>Assumptions to test</h2>
            <p className="editor-hint">
              Optional. Qalvi keeps these in mind to listen for evidence on either side. It never states them
              to participants or tries to confirm them.
            </p>
            <FieldError id={`${formId}-assumptions-error`} message={err("assumptions")} />
            <ul className="assumption-list">
              {assumptions.map((value, index) => (
                <li key={index}>
                  <label>
                    <span className="sr-only">Assumption {index + 1}</span>
                    <input
                      maxLength={LIMITS.assumption}
                      placeholder="e.g. Teams change tools after a missed deadline"
                      value={value}
                      onChange={(event) => {
                        touched();
                        setAssumptions((items) => items.map((other, at) => (at === index ? event.target.value : other)));
                      }}
                    />
                  </label>
                  <button type="button" className="icon-button" aria-label={`Remove assumption ${index + 1}`}
                    disabled={assumptions.length === 1 && !value}
                    onClick={() => {
                      touched();
                      setAssumptions((items) => (items.length > 1 ? items.filter((_, at) => at !== index) : [""]));
                    }}>×</button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" disabled={assumptions.length >= LIMITS.assumptions}
              onClick={() => { touched(); setAssumptions((items) => [...items, ""]); }}>
              ＋ Add assumption
            </Button>
          </Card>

          <Card className="draft-form editor-section">
            <span className="q-eyebrow">04 · AVAILABILITY</span>
            <h2>Status</h2>
            <div className="status-options" role="radiogroup" aria-label="Study status">
              {EDITABLE_STATUSES.map((value) => (
                <label key={value} className="status-option">
                  <input type="radio" name={`${formId}-status`} value={value} checked={status === value}
                    onChange={() => { touched(); setStatus(value); }} />
                  <span>
                    <strong>{STATUS_LABEL[value]}</strong>
                    {value === "draft" && "Only your workspace can see it. No participant links."}
                    {value === "active" && "Open for interviews. You can create participant links."}
                    {value === "completed" && "No new participant links or conversations."}
                  </span>
                </label>
              ))}
            </div>
            <FieldError id={`${formId}-status-error`} message={err("status")} />
          </Card>

          <div className="editor-actions">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : study ? "Save changes" : "Create study"}
            </Button>
            {study && <ButtonLink href={`/studies/${study.id}`} variant="quiet">Back to overview</ButtonLink>}
            <p ref={summary} tabIndex={-1} className={saved ? "editor-message" : "editor-message editor-message--error"}
              role="status">{message}</p>
          </div>
        </form>

        <div className="draft-aside">
          <Card className="brief-guidance editor-aside">
            <span className="q-eyebrow">READY FOR INTERVIEWS?</span>
            {gaps.length ? (
              <>
                <h2>Almost there.</h2>
                <p>To make this study active, add {gaps.join(", ")}.</p>
              </>
            ) : (
              <>
                <h2>Ready when you are.</h2>
                <p>
                  {status === "active"
                    ? "Once saved, create a private participant link from the study overview."
                    : "Set the status to Active and save to start inviting participants."}
                </p>
              </>
            )}
            <hr />
            <h3>Stay curious. Leave room to be surprised.</h3>
            <p>
              Start with a decision you need to make. Ask about real experiences before exploring possibilities.
            </p>
            <h3>Visuals are tools, not steps.</h3>
            <p>
              Qalvi shows a visual only when it helps the participant answer, and never one you have not
              written here.
            </p>
            {study && <Badge tone="indigo">Saved in your workspace</Badge>}
          </Card>
        </div>
      </div>
    </>
  );
}

function VisualFields({
  draft,
  index,
  onChange,
}: {
  draft: VisualDraft;
  index: number;
  onChange: (change: Partial<VisualDraft>) => void;
}) {
  const choices = draft.type === "comparison_cards" || draft.type === "multiple_choice";
  const maxOptions = draft.type === "comparison_cards" ? 4 : 6;
  return (
    <fieldset className="visual-fields">
      <legend>{VISUAL_LABEL[draft.type]} for objective {index + 1}</legend>
      <label>
        On-screen question
        <input maxLength={LIMITS.visualPrompt} value={draft.prompt} placeholder="What the participant sees above it"
          onChange={(event) => onChange({ prompt: event.target.value })} />
      </label>
      {choices && (
        <>
          {draft.options.map((option, at) => (
            <div key={at} className="visual-row">
              <label>
                {draft.type === "comparison_cards" ? `Card ${at + 1}` : `Choice ${at + 1}`}
                <input maxLength={LIMITS.visualText} value={option.label}
                  onChange={(event) => onChange({
                    options: draft.options.map((other, i) => (i === at ? { ...other, label: event.target.value } : other)),
                  })} />
              </label>
              {draft.type === "comparison_cards" && (
                <label>
                  Description
                  <input maxLength={LIMITS.visualText} value={option.description}
                    onChange={(event) => onChange({
                      options: draft.options.map((other, i) => (i === at ? { ...other, description: event.target.value } : other)),
                    })} />
                </label>
              )}
              <button type="button" className="icon-button" aria-label={`Remove option ${at + 1}`}
                disabled={draft.options.length <= 2}
                onClick={() => onChange({ options: draft.options.filter((_, i) => i !== at) })}>×</button>
            </div>
          ))}
          <div className="visual-row visual-row--end">
            <Button variant="quiet" disabled={draft.options.length >= maxOptions}
              onClick={() => onChange({ options: [...draft.options, { label: "", description: "" }] })}>
              ＋ Add option
            </Button>
            {draft.type === "multiple_choice" && (
              <label className="check-label">
                <input type="checkbox" checked={draft.multiple} onChange={(event) => onChange({ multiple: event.target.checked })} />
                Allow more than one choice
              </label>
            )}
          </div>
        </>
      )}
      {draft.type === "bar_chart" && (
        <>
          <p className="editor-hint">An illustrative chart for participants to compare with their own experience. It has no controls.</p>
          {draft.bars.map((bar, at) => (
            <div key={at} className="visual-row">
              <label>
                Bar {at + 1}
                <input maxLength={LIMITS.visualText} value={bar.label}
                  onChange={(event) => onChange({ bars: draft.bars.map((other, i) => (i === at ? { ...other, label: event.target.value } : other)) })} />
              </label>
              <label className="narrow">
                Value
                <input inputMode="decimal" value={bar.value}
                  onChange={(event) => onChange({ bars: draft.bars.map((other, i) => (i === at ? { ...other, value: event.target.value } : other)) })} />
              </label>
              <button type="button" className="icon-button" aria-label={`Remove bar ${at + 1}`} disabled={draft.bars.length <= 2}
                onClick={() => onChange({ bars: draft.bars.filter((_, i) => i !== at) })}>×</button>
            </div>
          ))}
          <div className="visual-row visual-row--end">
            <Button variant="quiet" disabled={draft.bars.length >= 8}
              onClick={() => onChange({ bars: [...draft.bars, { label: "", value: "" }] })}>＋ Add bar</Button>
            <label className="narrow">
              Unit
              <input maxLength={12} value={draft.unit} placeholder="%" onChange={(event) => onChange({ unit: event.target.value })} />
            </label>
          </div>
        </>
      )}
      {draft.type === "slider" && (
        <>
          <div className="visual-row visual-row--numbers">
            {(["min", "max", "step", "initial"] as const).map((key) => (
              <label key={key} className="narrow">
                {key === "initial" ? "Starts at" : key[0].toUpperCase() + key.slice(1)}
                <input inputMode="decimal" value={draft[key]} onChange={(event) => onChange({ [key]: event.target.value })} />
              </label>
            ))}
            <label className="narrow">
              Unit
              <input maxLength={12} value={draft.unit} placeholder="%" onChange={(event) => onChange({ unit: event.target.value })} />
            </label>
          </div>
          <div className="visual-row">
            <label>
              Low end label
              <input maxLength={LIMITS.visualText} value={draft.minLabel} placeholder="e.g. Rarely"
                onChange={(event) => onChange({ minLabel: event.target.value })} />
            </label>
            <label>
              High end label
              <input maxLength={LIMITS.visualText} value={draft.maxLabel} placeholder="e.g. Constantly"
                onChange={(event) => onChange({ maxLabel: event.target.value })} />
            </label>
          </div>
        </>
      )}
    </fieldset>
  );
}
