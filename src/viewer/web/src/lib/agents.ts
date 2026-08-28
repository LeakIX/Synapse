import Bot from '@lucide/svelte/icons/bot';
import Eye from '@lucide/svelte/icons/eye';
import FileText from '@lucide/svelte/icons/file-text';
import FlaskConical from '@lucide/svelte/icons/flask-conical';
import Wrench from '@lucide/svelte/icons/wrench';
import type { Component } from 'svelte';
import type { Issue } from './types';

/**
 * Agent identity: the icon and the colour token each agent owns. The graph
 * and the filters both read from here, so an agent looks the same
 * everywhere.
 *
 * The class names are complete literals. Tailwind scans this file, so it
 * only generates a utility that appears here in full.
 */

export const KNOWN_AGENTS = [
  'code-agent',
  'test-agent',
  'review-agent',
  'docs-agent',
] as const;

export type KnownAgent = (typeof KNOWN_AGENTS)[number];

const ICONS: Record<string, Component> = {
  'code-agent': Wrench,
  'test-agent': FlaskConical,
  'review-agent': Eye,
  'docs-agent': FileText,
};

const FILLS: Record<string, string> = {
  'code-agent': 'fill-agent-code',
  'test-agent': 'fill-agent-test',
  'review-agent': 'fill-agent-review',
  'docs-agent': 'fill-agent-docs',
};

const DOTS: Record<string, string> = {
  'code-agent': 'bg-agent-code',
  'test-agent': 'bg-agent-test',
  'review-agent': 'bg-agent-review',
  'docs-agent': 'bg-agent-docs',
};

/** The icon for an agent. An unknown agent gets the generic bot. */
export function agentIcon(name: string): Component {
  return ICONS[name] ?? Bot;
}

/** The SVG fill utility for an agent node. */
export function agentFill(name: string): string {
  return FILLS[name] ?? 'fill-agent-other';
}

/** The background utility for an agent swatch. */
export function agentDot(name: string): string {
  return DOTS[name] ?? 'bg-agent-other';
}

/**
 * Find the agent that owns an issue. A label `agent:<name>` wins. A title
 * prefix `[<name>]` is the fallback, and only for a known agent.
 */
export function issueAgent(issue: Issue): string | null {
  for (const label of issue.labels ?? []) {
    if (label.startsWith('agent:')) {
      return label.slice('agent:'.length);
    }
  }
  const match = issue.title.match(/^\[(\S+)\]/);
  if (match && (KNOWN_AGENTS as readonly string[]).includes(match[1])) {
    return match[1];
  }
  return null;
}
