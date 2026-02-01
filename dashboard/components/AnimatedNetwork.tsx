export function AnimatedNetwork() {
  // Bot node in center, channel nodes around it
  const botNode = { x: 400, y: 200 };
  const channelNodes = [
    { x: 150, y: 100, label: '@business_coach', delay: 0 },
    { x: 650, y: 100, label: '@personal_growth', delay: 0.5 },
    { x: 100, y: 300, label: '@expert_blog', delay: 1 },
    { x: 700, y: 300, label: '@marketing_pro', delay: 1.5 },
    { x: 250, y: 350, label: '@lifestyle_tips', delay: 2 },
    { x: 550, y: 350, label: '@finance_guru', delay: 2.5 },
  ];

  return (
    <svg
      viewBox="0 0 800 400"
      width="800"
      height="400"
      className="w-full h-full max-w-3xl mx-auto"
      style={{ filter: 'drop-shadow(0 0 40px rgb(139 124 246 / 0.15))' }}
    >
      <defs>
        {/* Gradient for connections */}
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.1 }} />
          <stop offset="50%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.6 }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.1 }} />
        </linearGradient>

        {/* Glow filter */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connection lines */}
      {channelNodes.map((node, i) => (
        <g key={`line-${i}`}>
          <line
            x1={botNode.x}
            y1={botNode.y}
            x2={node.x}
            y2={node.y}
            stroke="url(#lineGradient)"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="opacity-40"
          />
          {/* Animated pulse traveling along the line */}
          <circle r="4" fill="var(--accent-500)" filter="url(#glow)">
            <animateMotion
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay}s`}
              path={`M${botNode.x},${botNode.y} L${node.x},${node.y}`}
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay}s`}
            />
          </circle>
        </g>
      ))}

      {/* Bot node (center) */}
      <g className="animate-pulse" style={{ animationDuration: '3s' }}>
        <circle
          cx={botNode.x}
          cy={botNode.y}
          r="50"
          fill="none"
          stroke="var(--accent-500)"
          strokeWidth="1"
          strokeDasharray="8 4"
          className="opacity-30"
        />
        <circle
          cx={botNode.x}
          cy={botNode.y}
          r="35"
          fill="var(--neutral-850)"
          stroke="var(--accent-500)"
          strokeWidth="2"
          filter="url(#glow)"
        />
        {/* Bot icon - robot */}
        <g transform={`translate(${botNode.x - 14}, ${botNode.y - 14})`}>
          {/* Head */}
          <rect x="4" y="6" width="20" height="16" rx="3" fill="none" stroke="var(--accent-400)" strokeWidth="1.5" />
          {/* Eyes */}
          <circle cx="10" cy="13" r="2" fill="var(--accent-400)" />
          <circle cx="18" cy="13" r="2" fill="var(--accent-400)" />
          {/* Antenna */}
          <line x1="14" y1="6" x2="14" y2="2" stroke="var(--accent-400)" strokeWidth="1.5" />
          <circle cx="14" cy="1.5" r="1.5" fill="var(--accent-400)" />
          {/* Smile */}
          <path d="M9 17c1.5 1.5 4.5 1.5 6 0" fill="none" stroke="var(--accent-400)" strokeWidth="1.2" />
        </g>
      </g>

      {/* Channel nodes */}
      {channelNodes.map((node, i) => (
        <g key={`node-${i}`}>
          <circle
            cx={node.x}
            cy={node.y}
            r="30"
            fill="var(--neutral-900)"
            stroke="var(--neutral-700)"
            strokeWidth="1"
          />
          <circle
            cx={node.x}
            cy={node.y}
            r="22"
            fill="var(--neutral-850)"
          />
          {/* Channel icon - broadcast symbol */}
          <g transform={`translate(${node.x - 8}, ${node.y - 8})`}>
            <circle cx="8" cy="8" r="2" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" />
            <path d="M4 4c2.2-2.2 5.8-2.2 8 0" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" />
            <path d="M4 12c2.2 2.2 5.8 2.2 8 0" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" />
          </g>
          {/* Channel label */}
          <text
            x={node.x}
            y={node.y + 50}
            textAnchor="middle"
            className="fill-text-tertiary text-xs"
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            {node.label}
          </text>
        </g>
      ))}

      {/* Flying comments */}
      {channelNodes.map((node, i) => (
        <g key={`comment-${i}`}>
          <rect
            width="50"
            height="16"
            rx="3"
            fill="var(--accent-500)"
            fillOpacity="0.15"
          >
            <animateMotion
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
              path={`M${botNode.x - 25},${botNode.y - 8} L${node.x - 25},${node.y - 8}`}
            />
            <animate
              attributeName="fill-opacity"
              values="0;0.25;0.25;0"
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
            />
          </rect>
          {/* Comment icon */}
          <g>
            <animateMotion
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
              path={`M${botNode.x - 20},${botNode.y - 2} L${node.x - 20},${node.y - 2}`}
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="4s"
              repeatCount="indefinite"
              begin={`${node.delay + 1}s`}
            />
            <rect x="0" y="-4" width="10" height="8" rx="1" fill="none" stroke="var(--accent-400)" strokeWidth="1" />
            <path d="M0 4l3 3v-3" fill="var(--accent-400)" />
          </g>
        </g>
      ))}
    </svg>
  );
}
