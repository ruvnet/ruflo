/**
 * AnimatedEdge Component
 *
 * SVG line between nodes with:
 * - Dashed line style for inactive, solid for active
 * - Color based on health (green=healthy, yellow=warning, red=error)
 * - Glow effect when active
 */

import React from 'react';
import type { AnimatedEdgeProps } from '../../types';
import { getHealthColor } from '../../types';

export const AnimatedEdge: React.FC<AnimatedEdgeProps> = ({
  source,
  target,
  health,
  isActive,
  id,
}) => {
  const color = getHealthColor(health);
  const strokeWidth = isActive ? 2.5 : 1.5;
  const opacity = isActive ? 1 : 0.6;
  const strokeDasharray = isActive ? 'none' : '6,4';

  // Calculate glow filter ID
  const filterId = `glow-${id}`;

  return (
    <g className="animated-edge">
      {/* Glow filter definition */}
      {isActive && (
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}

      {/* Background line for glow effect */}
      {isActive && (
        <line
          x1={source.x}
          y1={source.y}
          x2={target.x}
          y2={target.y}
          stroke={color}
          strokeWidth={strokeWidth + 4}
          strokeOpacity={0.3}
          strokeLinecap="round"
          filter={`url(#${filterId})`}
        />
      )}

      {/* Main edge line */}
      <line
        x1={source.x}
        y1={source.y}
        x2={target.x}
        y2={target.y}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        style={{
          transition: 'stroke 0.3s ease, stroke-width 0.3s ease, stroke-opacity 0.3s ease',
        }}
      />

      {/* Animated pulse for active edges */}
      {isActive && (
        <line
          x1={source.x}
          y1={source.y}
          x2={target.x}
          y2={target.y}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeOpacity={0}
          strokeLinecap="round"
          style={{
            animation: 'edgePulse 2s ease-in-out infinite',
          }}
        />
      )}

      {/* Inline keyframes for pulse animation */}
      <style>
        {`
          @keyframes edgePulse {
            0%, 100% {
              stroke-opacity: 0;
              stroke-width: ${strokeWidth}px;
            }
            50% {
              stroke-opacity: 0.5;
              stroke-width: ${strokeWidth + 2}px;
            }
          }
        `}
      </style>
    </g>
  );
};

export default AnimatedEdge;
