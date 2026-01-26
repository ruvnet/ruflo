/**
 * TopologyControls Component
 *
 * Control panel for the topology visualization including:
 * - Layout selector (hierarchical, mesh, force)
 * - Zoom controls (+, -, fit to screen)
 * - Toggle labels on/off
 * - Toggle message animations on/off
 */

import React from 'react';
import type { TopologyControlsProps, TopologyLayoutType } from '../../types';

const layoutOptions: { value: TopologyLayoutType; label: string; icon: string }[] = [
  { value: 'hierarchical', label: 'Hierarchical', icon: 'H' },
  { value: 'mesh', label: 'Mesh', icon: 'M' },
  { value: 'force', label: 'Force', icon: 'F' },
];

export const TopologyControls: React.FC<TopologyControlsProps> = ({
  layout,
  onLayoutChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  showLabels,
  onToggleLabels,
  showAnimations,
  onToggleAnimations,
}) => {
  return (
    <div className="topology-controls" style={styles.container}>
      {/* Layout Selector */}
      <div style={styles.section}>
        <span style={styles.label}>Layout</span>
        <div style={styles.buttonGroup}>
          {layoutOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onLayoutChange(option.value)}
              style={{
                ...styles.button,
                ...(layout === option.value ? styles.buttonActive : {}),
              }}
              title={option.label}
              aria-label={`Switch to ${option.label} layout`}
              aria-pressed={layout === option.value}
            >
              {option.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Zoom Controls */}
      <div style={styles.section}>
        <span style={styles.label}>Zoom</span>
        <div style={styles.buttonGroup}>
          <button
            onClick={onZoomOut}
            style={styles.button}
            title="Zoom out"
            aria-label="Zoom out"
            disabled={zoom <= 0.25}
          >
            -
          </button>
          <span style={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
          <button
            onClick={onZoomIn}
            style={styles.button}
            title="Zoom in"
            aria-label="Zoom in"
            disabled={zoom >= 4}
          >
            +
          </button>
          <button
            onClick={onFitToScreen}
            style={styles.button}
            title="Fit to screen"
            aria-label="Fit to screen"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Toggle Controls */}
      <div style={styles.section}>
        <span style={styles.label}>Display</span>
        <div style={styles.buttonGroup}>
          <button
            onClick={onToggleLabels}
            style={{
              ...styles.button,
              ...(showLabels ? styles.buttonActive : {}),
            }}
            title={showLabels ? 'Hide labels' : 'Show labels'}
            aria-label={showLabels ? 'Hide labels' : 'Show labels'}
            aria-pressed={showLabels}
          >
            Labels
          </button>
          <button
            onClick={onToggleAnimations}
            style={{
              ...styles.button,
              ...(showAnimations ? styles.buttonActive : {}),
            }}
            title={showAnimations ? 'Disable animations' : 'Enable animations'}
            aria-label={showAnimations ? 'Disable animations' : 'Enable animations'}
            aria-pressed={showAnimations}
          >
            Animate
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    padding: '12px 16px',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: '8px',
    border: '1px solid rgba(71, 85, 105, 0.5)',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  buttonGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#e2e8f0',
    backgroundColor: 'rgba(51, 65, 85, 0.8)',
    border: '1px solid rgba(71, 85, 105, 0.5)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    minWidth: '32px',
  },
  buttonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
    borderColor: '#3b82f6',
    color: '#3b82f6',
  },
  zoomLevel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#94a3b8',
    minWidth: '44px',
    textAlign: 'center' as const,
  },
};

export default TopologyControls;
