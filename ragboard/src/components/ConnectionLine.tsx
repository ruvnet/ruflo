import React from 'react';
import { getBezierPath, BaseEdge } from '@xyflow/react';
import type { EdgeProps } from '../types';

export const ConnectionLine: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge 
        id={id} 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={{
          ...style,
          stroke: '#9333ea',
          strokeWidth: 2,
          strokeDasharray: '5 5',
          animation: 'dash 1s linear infinite',
        }}
      />
    </>
  );
};