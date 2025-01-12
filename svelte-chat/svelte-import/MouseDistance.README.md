# Mouse Distance Widget

A Svelte component that tracks and displays mouse movement statistics in real-time. This widget shows both cumulative movement and average motion of the mouse cursor.

## Features

- Real-time mouse movement tracking
- Cumulative distance measurement
- Smoothed average motion display
- Configurable update intervals
- TypeScript support
- Modern, semi-transparent UI with blur effect

## Installation

1. Copy the `MouseDistanceWidget.svelte` file into your project's components directory.
2. Ensure your project has Svelte and TypeScript support configured.

## Usage

### Basic Implementation

```svelte
<script lang="ts">
  import MouseDistanceWidget from './path/to/MouseDistanceWidget.svelte';
</script>

<MouseDistanceWidget />
```

### With Custom Intervals

```svelte
<script lang="ts">
  import MouseDistanceWidget from './path/to/MouseDistanceWidget.svelte';
</script>

<MouseDistanceWidget 
  updateInterval={200}  // Update motion delta every 200ms
  averageInterval={1500}  // Calculate average motion every 1.5 seconds
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `updateInterval` | `number` | `100` | Milliseconds between motion delta updates |
| `averageInterval` | `number` | `1000` | Milliseconds between average motion calculations |

## Styling

The widget comes with default styling that includes:
- Semi-transparent dark background
- Blue border accent
- Monospace font
- Blur effect backdrop filter

You can override the default styles by targeting these classes in your global CSS:
- `.mouse-distance-widget`: Main container
- `.movement-overlay`: Cumulative movement display
- `.average-motion-overlay`: Average motion display

### Example Style Override

```css
:global(.mouse-distance-widget) {
  background: rgba(0, 0, 0, 0.8);
  border-color: #ff0000;
}
```

## Technical Details

The widget tracks mouse movement using these metrics:
- **Cumulative Movement**: Total distance the mouse has traveled
- **Average Motion**: Smoothed average of recent mouse movement
- **Delta Motion**: Change in movement since last update

The movement calculations use Euclidean distance and linear interpolation (lerp) for smooth updates.

## Browser Support

Requires browsers that support:
- CSS backdrop-filter
- CSS position: fixed
- Modern JavaScript (ES6+)
- RequestAnimationFrame API

## Performance Considerations

The widget uses:
- Throttled interval updates to prevent performance issues
- Cleanup on component destruction to prevent memory leaks
- Efficient array operations for motion history

## Troubleshooting

1. **Widget not visible**: Ensure z-index conflicts aren't hiding the widget
2. **Blur effect not working**: Check browser support for backdrop-filter
3. **Performance issues**: Try increasing updateInterval and averageInterval values
