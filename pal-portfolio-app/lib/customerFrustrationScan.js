/**
 * Lightweight scan of **customer-authored** text for frustration / anger cues (“red” sentiment).
 * Not a substitute for ML — tuned for obvious support phrases.
 */

/** @type {{ re: RegExp; label: string }[]} */
const FRUSTRATION_PATTERNS = [
  { re: /\bfrustrat\w*/i, label: "frustrated" },
  { re: /\b(unacceptable|outrageous|ridiculous)\b/i, label: "unacceptable tone" },
  { re: /\b(angry|furious|fed up|sick of)\b/i, label: "anger wording" },
  { re: /\b(this is|this is really|this is absolutely)\s+(not acceptable|unacceptable|ridiculous)\b/i, label: "not acceptable" },
  { re: /\b(still not working|still doesn't work|still broken|still failing)\b/i, label: "still broken" },
  { re: /\b(nothing works|doesn't work at all|completely broken)\b/i, label: "nothing works" },
  { re: /\b(waste of time|wasting our time|wasting my time)\b/i, label: "waste of time" },
  { re: /\b(very disappointed|extremely disappointed|deeply disappointed)\b/i, label: "disappointed" },
  { re: /\b(terrible|awful|horrible)\s+(support|experience|service|product)\b/i, label: "terrible experience" },
  { re: /\b(not helpful|unhelpful|useless)\b/i, label: "not helpful" },
  { re: /\b(escalat\w*|speak to a manager|need this escalated)\b/i, label: "escalation ask" },
  { re: /\b(losing patience|running out of patience|last straw)\b/i, label: "patience exhausted" },
  { re: /\b(urgent|asap|immediately)\b.*\b(issue|problem|broken|down)\b/i, label: "urgent + broken" },
  { re: /\b(why (isn't|is not|hasn't|has not))\b/i, label: "why isn't" },
  { re: /\b(no one (has|have) (responded|replied|gotten back))\b/i, label: "no response" },
  { re: /\b(unprofessional|incompetent)\b/i, label: "harsh criticism" },
];

/**
 * @param {string} text
 * @returns {{ red: boolean; phrases: string[] }}
 */
export function scanCustomerFrustrationText(text) {
  const raw = String(text || "");
  const t = raw.length > 120_000 ? raw.slice(0, 120_000) : raw;
  if (!t.trim()) return { red: false, phrases: [] };

  /** @type {string[]} */
  const hits = [];
  for (const { re, label } of FRUSTRATION_PATTERNS) {
    if (re.test(t)) hits.push(label);
  }
  const uniq = [...new Set(hits)];
  return { red: uniq.length > 0, phrases: uniq.slice(0, 10) };
}
