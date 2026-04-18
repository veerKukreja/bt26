import type { WriteUp } from "./types";

export function writeupToMarkdown(w: WriteUp): string {
  const lines: string[] = [];
  lines.push(`# ${w.title}`);
  lines.push("");
  lines.push("## Problem");
  lines.push(w.problem);
  lines.push("");
  lines.push("## Users");
  for (const u of w.users) {
    lines.push(`- **${u.persona}** — ${u.jobToBeDone}`);
  }
  lines.push("");
  lines.push("## Value proposition");
  lines.push(w.valueProp);
  lines.push("");
  lines.push("## Features");
  if (w.features.mustHave.length > 0) {
    lines.push("### Must have");
    for (const f of w.features.mustHave) lines.push(`- ${f}`);
    lines.push("");
  }
  if (w.features.shouldHave.length > 0) {
    lines.push("### Should have");
    for (const f of w.features.shouldHave) lines.push(`- ${f}`);
    lines.push("");
  }
  if (w.features.couldHave.length > 0) {
    lines.push("### Could have");
    for (const f of w.features.couldHave) lines.push(`- ${f}`);
    lines.push("");
  }
  if (w.pages.length > 0) {
    lines.push("## Pages");
    for (const p of w.pages) {
      lines.push(`### ${p.name}`);
      lines.push(p.purpose);
      if (p.keyElements.length > 0) {
        lines.push("");
        for (const e of p.keyElements) lines.push(`- ${e}`);
      }
      lines.push("");
    }
  }
  lines.push("## Copy direction");
  lines.push(w.copyDirection);
  lines.push("");
  lines.push("## Visual direction");
  lines.push(w.visualDirection);
  lines.push("");
  if (w.risks.length > 0) {
    lines.push("## Risks");
    for (const r of w.risks) lines.push(`- ${r}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

export function writeupToGithubIssue(w: WriteUp): string {
  const md = writeupToMarkdown(w);
  const checklistLines: string[] = [];
  checklistLines.push("## Acceptance");
  for (const f of w.features.mustHave) checklistLines.push(`- [ ] ${f}`);
  checklistLines.push("");
  return `${md}\n${checklistLines.join("\n")}`;
}
