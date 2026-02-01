export function AnimatedNetworkMobile() {
  const botNode = { x: 250, y: 100 };
  const channelNodes = [
    { x: 60, y: 50, label: '@business', delay: 0 },
    { x: 160, y: 170, label: '@growth', delay: 0.7 },
    { x: 340, y: 170, label: '@expert', delay: 1.4 },
    { x: 440, y: 50, label: '@finance', delay: 2.1 },
  ];

  return (
    <svg
      viewBox="0 0 500 220"
      width="500"
      height="220"
      className="w-full h-full opacity-60"
      preserveAspectRatio="xMidYMid meet"
      style={{ filter: 'drop-shadow(0 0 20px rgb(139 124 246 / 0.15))' }}
    >
      <defs>
        <linearGradient id="lineGradientMobile" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.1 }} />
          <stop offset="50%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.6 }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.1 }} />
        </linearGradient>
        <filter id="glowMobile">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Connection lines */}
      {channelNodes.map((node, i) => (
        <g key={`line-m-${i}`}>
          <line
            x1={botNode.x}
            y1={botNode.y}
            x2={node.x}
            y2={node.y}
            stroke="url(#lineGradientMobile)"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="opacity-40"
          />
          <circle r="3" fill="var(--accent-500)" filter="url(#glowMobile)">
            <animateMotion
              dur="2.5s"
              repeatCount="indefinite"
              begin={`${node.delay}s`}
              path={`M${botNode.x},${botNode.y} L${node.x},${node.y}`}
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur="2.5s"
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
          r="40"
          fill="none"
          stroke="var(--accent-500)"
          strokeWidth="1"
          strokeDasharray="6 3"
          className="opacity-30"
        />
        <circle
          cx={botNode.x}
          cy={botNode.y}
          r="28"
          fill="var(--neutral-850)"
          stroke="var(--accent-500)"
          strokeWidth="1.5"
          filter="url(#glowMobile)"
        />
        {/* Bot icon */}
        <g transform={`translate(${botNode.x - 12}, ${botNode.y - 12})`}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="var(--accent-400)" strokeWidth="1.3" />
          <circle cx="9" cy="11" r="1.8" fill="var(--accent-400)" />
          <circle cx="15" cy="11" r="1.8" fill="var(--accent-400)" />
          <line x1="12" y1="5" x2="12" y2="2" stroke="var(--accent-400)" strokeWidth="1.3" />
          <circle cx="12" cy="1.5" r="1.3" fill="var(--accent-400)" />
          <path d="M8 15c1.2 1.2 3.8 1.2 5 0" fill="none" stroke="var(--accent-400)" strokeWidth="1" />
        </g>
      </g>

      {/* Channel nodes */}
      {channelNodes.map((node, i) => (
        <g key={`node-m-${i}`}>
          <circle
            cx={node.x}
            cy={node.y}
            r="24"
            fill="var(--neutral-900)"
            stroke="var(--neutral-700)"
            strokeWidth="1"
          />
          <circle
            cx={node.x}
            cy={node.y}
            r="18"
            fill="var(--neutral-850)"
          />
          {/* Broadcast icon */}
          <g transform={`translate(${node.x - 6}, ${node.y - 6})`}>
            <circle cx="6" cy="6" r="1.5" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.2" />
            <path d="M3 3c1.7-1.7 4.3-1.7 6 0" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.2" />
            <path d="M3 9c1.7 1.7 4.3 1.7 6 0" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.2" />
          </g>
          <text
            x={node.x}
            y={node.y + 32}
            textAnchor="middle"
            className="fill-text-tertiary"
            style={{ fontFamily: 'var(--font-sans)', fontSize: '9px' }}
          >
            {node.label}
          </text>
        </g>
      ))}

      {/* Flying comments */}
      {channelNodes.map((node, i) => (
        <g key={`comment-m-${i}`}>
          <rect
            width="30"
            height="12"
            rx="2"
            fill="var(--accent-500)"
            fillOpacity="0.15"
          >
            <animateMotion
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay + 0.8}s`}
              path={`M${botNode.x - 15},${botNode.y - 6} L${node.x - 15},${node.y - 6}`}
            />
            <animate
              attributeName="fill-opacity"
              values="0;0.25;0.25;0"
              dur="3s"
              repeatCount="indefinite"
              begin={`${node.delay + 0.8}s`}
            />
          </rect>
        </g>
      ))}
    </svg>
  );
}
