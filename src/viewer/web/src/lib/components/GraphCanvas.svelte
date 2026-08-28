<!--
  GraphCanvas. The dependency graph, drawn as SVG.

  Props:
  - issues: Issue[], required. Only the visible issues.
  - edges: GraphEdge[], required. The canvas hides an edge whose two ends
    are not both visible.
  - tasks: Map<string, QueueTask>, required. The queue, keyed by issue.
  - positions: Record<string, Point>, bindable, required. The layout gives
    the points. A node drag writes back into this record.
  - selectedId: string | null, bindable, required.
  - onopen: (id: string) => void, required. The canvas calls it when the
    reader opens a node.

  The reader pans by dragging the background, zooms with the wheel, moves a
  node by dragging it, and opens a node with a double click, with the Enter
  key, or with the Space key. Each node is a focus stop, so the graph works
  from the keyboard.
-->
<script lang="ts">
  import {
    isPullRequest,
    nodeFill,
    nodeRadius,
    nodeShape,
    pullRequestNumber,
  } from '$lib/graph';
  import type { GraphEdge, Issue, QueueTask } from '$lib/types';
  import type { Point } from '$lib/layout';

  let {
    issues,
    edges,
    tasks,
    positions = $bindable(),
    selectedId = $bindable(),
    onopen,
  }: {
    issues: Issue[];
    edges: GraphEdge[];
    tasks: Map<string, QueueTask>;
    positions: Record<string, Point>;
    selectedId: string | null;
    onopen: (id: string) => void;
  } = $props();

  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 8;
  const LABEL_LIMIT = 32;

  let width = $state(0);
  let height = $state(0);
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);

  let dragNode: { id: string; mx: number; my: number; x: number; y: number } | null =
    $state(null);
  let dragPan: { mx: number; my: number } | null = $state(null);

  let visible = $derived(new Set(issues.map((issue) => issue.id)));
  let visibleEdges = $derived(
    edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)),
  );
  let viewBox = $derived(
    `${-width / 2} ${-height / 2} ${Math.max(width, 1)} ${Math.max(height, 1)}`,
  );

  function at(id: string): Point {
    return positions[id] ?? { x: 0, y: 0 };
  }

  function label(title: string): string {
    return title.length > LABEL_LIMIT ? `${title.slice(0, LABEL_LIMIT - 2)}..` : title;
  }

  function startNodeDrag(event: PointerEvent, id: string) {
    event.stopPropagation();
    const point = at(id);
    dragNode = { id, mx: event.clientX, my: event.clientY, x: point.x, y: point.y };
    selectedId = id;
  }

  function startPan(event: PointerEvent) {
    dragPan = { mx: event.clientX - panX, my: event.clientY - panY };
  }

  function onPointerMove(event: PointerEvent) {
    if (dragNode) {
      positions[dragNode.id] = {
        x: dragNode.x + (event.clientX - dragNode.mx) / zoom,
        y: dragNode.y + (event.clientY - dragNode.my) / zoom,
      };
    } else if (dragPan) {
      panX = event.clientX - dragPan.mx;
      panY = event.clientY - dragPan.my;
    }
  }

  function endDrag() {
    dragNode = null;
    dragPan = null;
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  function onNodeKey(event: KeyboardEvent, id: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onopen(id);
    }
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} />

<div
  class="relative h-full w-full"
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  <svg
    class="h-full w-full cursor-grab active:cursor-grabbing"
    {viewBox}
    role="application"
    aria-label="Issue dependency graph"
    onpointerdown={startPan}
    onwheel={onWheel}
    ondblclick={resetView}
  >
    <g transform={`translate(${panX},${panY}) scale(${zoom})`}>
      {#each visibleEdges as edge (`${edge.from}>${edge.to}>${edge.kind}`)}
        <line
          x1={at(edge.from).x}
          y1={at(edge.from).y}
          x2={at(edge.to).x}
          y2={at(edge.to).y}
          stroke-width="1.5"
          stroke-dasharray={edge.kind === 'parent' ? '5,5' : 'none'}
          class={edge.kind === 'parent'
            ? 'stroke-edge-parent opacity-60'
            : 'stroke-edge-blocks opacity-70'}
        />
      {/each}

      {#each issues as issue (issue.id)}
        {@const task = tasks.get(issue.id)}
        {@const point = at(issue.id)}
        {@const radius = nodeRadius(issue, task)}
        {@const shape = nodeShape(issue, task)}
        {@const outline =
          issue.status === 'blocked'
            ? 'stroke-text'
            : issue.id === selectedId
              ? 'stroke-primary'
              : 'stroke-transparent'}
        <g
          role="button"
          tabindex="0"
          aria-label={`${issue.title}. ${issue.status}.`}
          class="cursor-pointer focus-visible:outline-none"
          transform={`translate(${point.x},${point.y})`}
          onpointerdown={(event) => startNodeDrag(event, issue.id)}
          ondblclick={(event) => {
            event.stopPropagation();
            onopen(issue.id);
          }}
          onkeydown={(event) => onNodeKey(event, issue.id)}
        >
          {#if shape === 'square'}
            <rect
              x={-radius}
              y={-radius}
              width={radius * 2}
              height={radius * 2}
              rx="4"
              stroke-width="2"
              class={`${nodeFill(issue, task)} ${outline}`}
            />
          {:else if shape === 'diamond'}
            <polygon
              points={`0,${-radius * 1.2} ${radius * 1.2},0 0,${radius * 1.2} ${-radius * 1.2},0`}
              stroke-width="2"
              class={`${nodeFill(issue, task)} ${outline}`}
            />
          {:else}
            <circle
              r={radius}
              stroke-width="2"
              class={`${nodeFill(issue, task)} ${outline}`}
            />
          {/if}

          {#if isPullRequest(issue)}
            <text
              y="4"
              text-anchor="middle"
              font-size="9"
              font-weight="bold"
              class="fill-on-primary"
            >
              #{pullRequestNumber(issue)}
            </text>
          {:else if issue.issue_type === 'epic'}
            <text
              y="4"
              text-anchor="middle"
              font-size="10"
              font-weight="bold"
              class="fill-on-primary"
            >
              E
            </text>
          {/if}

          <text
            y={radius + 14}
            text-anchor="middle"
            font-size="10"
            class="fill-muted"
          >
            {label(issue.title)}
          </text>
        </g>
      {/each}
    </g>
  </svg>
</div>
