/**
 * MessageParticle Component
 *
 * Animated circle that travels along edge path:
 * - Uses Framer Motion for smooth animation
 * - Fades out on reaching target
 * - Calls onComplete when animation finishes
 */

import React, { useEffect, useState } from 'react';
import { motion, useAnimation } from 'framer-motion';
import type { MessageParticleProps } from '../../types';
import { getMessageTypeColor } from '../../types';

const PARTICLE_RADIUS = 6;
const ANIMATION_DURATION = 0.8; // seconds

export const MessageParticle: React.FC<MessageParticleProps> = ({
  sourcePos,
  targetPos,
  onComplete,
  messageType = 'task',
}) => {
  const controls = useAnimation();
  const [isVisible, setIsVisible] = useState(true);
  const color = getMessageTypeColor(messageType);

  useEffect(() => {
    const animateParticle = async () => {
      // Animate from source to target
      await controls.start({
        cx: targetPos.x,
        cy: targetPos.y,
        opacity: [1, 1, 0.8, 0],
        scale: [1, 1.2, 1, 0.5],
        transition: {
          duration: ANIMATION_DURATION,
          ease: 'easeInOut',
          times: [0, 0.3, 0.7, 1],
        },
      });

      setIsVisible(false);
      onComplete();
    };

    animateParticle();
  }, [controls, targetPos, onComplete]);

  if (!isVisible) return null;

  return (
    <g className="message-particle">
      {/* Glow effect */}
      <defs>
        <filter id={`particle-glow-${color.replace('#', '')}`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`particle-gradient-${color.replace('#', '')}`}>
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="50%" stopColor={color} stopOpacity="0.8" />
          <stop offset="100%" stopColor={color} stopOpacity="0.2" />
        </radialGradient>
      </defs>

      {/* Outer glow */}
      <motion.circle
        initial={{ cx: sourcePos.x, cy: sourcePos.y, opacity: 0.5 }}
        animate={controls}
        r={PARTICLE_RADIUS + 4}
        fill={`url(#particle-gradient-${color.replace('#', '')})`}
        filter={`url(#particle-glow-${color.replace('#', '')})`}
      />

      {/* Inner particle */}
      <motion.circle
        initial={{ cx: sourcePos.x, cy: sourcePos.y, opacity: 1, scale: 1 }}
        animate={controls}
        r={PARTICLE_RADIUS}
        fill={color}
        style={{
          filter: 'brightness(1.2)',
        }}
      />

      {/* Center highlight */}
      <motion.circle
        initial={{ cx: sourcePos.x, cy: sourcePos.y, opacity: 1, scale: 1 }}
        animate={controls}
        r={PARTICLE_RADIUS / 2}
        fill="white"
        opacity={0.6}
      />
    </g>
  );
};

export default MessageParticle;
