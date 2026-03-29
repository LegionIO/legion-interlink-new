import { useState, type FC } from 'react';

const ACTIVE_PHASES = [
  'sensory_processing', 'emotional_evaluation', 'gut_instinct', 'memory_retrieval',
  'working_memory_integration', 'action_selection', 'prediction_engine', 'social_cognition',
  'theory_of_mind', 'homeostasis_regulation', 'identity_entropy_check', 'post_tick_reflection',
  'knowledge_retrieval', 'knowledge_promotion', 'procedural_check', 'mesh_interface',
];

const DREAM_PHASES = [
  'dream_onset', 'dream_narrative', 'dream_emotion', 'dream_consolidation',
  'dream_creativity', 'dream_rehearsal', 'dream_integration', 'dream_emergence',
];

interface PhaseState {
  name: string;
  status: 'running' | 'completed' | 'idle' | 'skipped';
  last_run?: string;
  duration_ms?: number;
  budget_ms?: number;
}

interface Props {
  phases: PhaseState[];
  tickMode: string;
  tickCount: number;
}

function formatPhaseName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function phaseColor(status: string): string {
  switch (status) {
    case 'running': return '#34d399';
    case 'completed': return '#6ee7b7';
    case 'skipped': return 'transparent';
    default: return '#525252';
  }
}

function phaseStroke(status: string): string {
  return status === 'skipped' ? '#525252' : 'none';
}

function phaseDash(status: string): string {
  return status === 'skipped' ? '3,3' : 'none';
}

export const GaiaPhaseWheel: FC<Props> = ({ phases, tickMode, tickCount }) => {
  const [hoveredPhase, setHoveredPhase] = useState<PhaseState | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const cx = 200;
  const cy = 200;
  const outerR = 160;
  const innerR = 100;
  const nodeR = 12;
  const innerNodeR = 9;

  const phaseMap = new Map(phases.map((p) => [p.name, p]));

  const modeColor: Record<string, string> = {
    dormant: '#737373',
    sentinel: '#f59e0b',
    full_active: '#34d399',
    dormant_active: '#a78bfa',
  };

  return (
    <div className="relative flex justify-center">
      <svg viewBox="0 0 400 400" className="h-[360px] w-[360px]">
        {/* Outer ring track */}
        <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="currentColor" strokeWidth="1" className="text-border/30" />
        {/* Inner ring track */}
        <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="currentColor" strokeWidth="1" className="text-border/20" />

        {/* Active phases — outer ring */}
        {ACTIVE_PHASES.map((name, i) => {
          const angle = (i / ACTIVE_PHASES.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + outerR * Math.cos(angle);
          const y = cy + outerR * Math.sin(angle);
          const state = phaseMap.get(name) || { name, status: 'idle' as const };
          const isRunning = state.status === 'running';

          return (
            <g key={name}
              onMouseEnter={(e) => { setHoveredPhase(state); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setHoveredPhase(null)}
              className="cursor-pointer"
            >
              {isRunning && (
                <circle cx={x} cy={y} r={nodeR + 4} fill={phaseColor(state.status)} opacity={0.2}>
                  <animate attributeName="r" values={`${nodeR + 2};${nodeR + 6};${nodeR + 2}`} dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0.1;0.3" dur="1.5s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={x} cy={y} r={nodeR}
                fill={phaseColor(state.status)}
                stroke={phaseStroke(state.status)}
                strokeWidth="1.5"
                strokeDasharray={phaseDash(state.status)}
              />
              {/* Phase label — abbreviated */}
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-current text-[6px] text-foreground/70 pointer-events-none select-none">
                {state.name ? state.name.slice(0, 3).toUpperCase() : (i + 1).toString()}
              </text>
            </g>
          );
        })}

        {/* Dream phases — inner ring */}
        {DREAM_PHASES.map((name, i) => {
          const angle = (i / DREAM_PHASES.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + innerR * Math.cos(angle);
          const y = cy + innerR * Math.sin(angle);
          const state = phaseMap.get(name) || { name, status: 'idle' as const };
          const isRunning = state.status === 'running';

          return (
            <g key={name}
              onMouseEnter={(e) => { setHoveredPhase(state); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setHoveredPhase(null)}
              className="cursor-pointer"
            >
              {isRunning && (
                <circle cx={x} cy={y} r={innerNodeR + 3} fill="#a78bfa" opacity={0.2}>
                  <animate attributeName="r" values={`${innerNodeR + 1};${innerNodeR + 5};${innerNodeR + 1}`} dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={x} cy={y} r={innerNodeR}
                fill={state.status === 'idle' ? '#525252' : '#a78bfa'}
                stroke={phaseStroke(state.status)}
                strokeWidth="1"
                strokeDasharray={phaseDash(state.status)}
                opacity={state.status === 'idle' ? 0.5 : 1}
              />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-current text-[5px] text-foreground/50 pointer-events-none select-none">
                D{i + 1}
              </text>
            </g>
          );
        })}

        {/* Center text */}
        <text x={cx} y={cy - 10} textAnchor="middle" className="fill-current text-sm font-semibold" style={{ fill: modeColor[tickMode] || '#737373' }}>
          {tickMode?.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN'}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-current text-[10px] text-muted-foreground">
          tick #{tickCount.toLocaleString()}
        </text>
      </svg>

      {/* Hover tooltip — positioned via portal-style fixed positioning */}
      {hoveredPhase && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-border/50 bg-popover/95 px-3 py-2 shadow-xl backdrop-blur-xl"
          style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 40 }}
        >
          <p className="text-xs font-semibold">{formatPhaseName(hoveredPhase.name)}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{hoveredPhase.status}</p>
          {hoveredPhase.duration_ms != null && <p className="text-[10px] text-muted-foreground">{hoveredPhase.duration_ms}ms</p>}
          {hoveredPhase.budget_ms != null && <p className="text-[10px] text-muted-foreground">Budget: {hoveredPhase.budget_ms}ms</p>}
          {hoveredPhase.last_run && <p className="text-[10px] text-muted-foreground">{hoveredPhase.last_run}</p>}
        </div>
      )}
    </div>
  );
};
