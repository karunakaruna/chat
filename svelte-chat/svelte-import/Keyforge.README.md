# Keyforge Widget for React + TypeScript

A React component that implements an interactive key and lock forging system with drag-and-drop functionality and encryption features.

## Features

- Create keys and locks with encrypted data
- Drag and drop interaction
- Context menu for item creation
- Status messages
- Metadata display on hover
- TypeScript support with full type definitions
- Customizable through props and CSS

## Installation

1. Copy both `KeyforgeWidget.tsx` and `KeyforgeWidget.css` into your project's components directory
2. Ensure your project has the following dependencies:
   - React 17+ 
   - TypeScript 4.5+

## Usage

### Basic Implementation

```tsx
import KeyforgeWidget from './components/KeyforgeWidget';

function App() {
  return (
    <div className="app">
      <KeyforgeWidget />
    </div>
  );
}
```

### With Event Handlers

```tsx
import KeyforgeWidget from './components/KeyforgeWidget';
import { DraggableItem } from './components/KeyforgeWidget';

function App() {
  const handleItemCreate = (item: DraggableItem) => {
    console.log('New item created:', item);
  };

  const handleItemUpdate = (item: DraggableItem) => {
    console.log('Item updated:', item);
  };

  return (
    <div className="app">
      <KeyforgeWidget 
        onItemCreate={handleItemCreate}
        onItemUpdate={handleItemUpdate}
      />
    </div>
  );
}
```

## Props

| Prop | Type | Description |
|------|------|-------------|
| `onItemCreate` | `(item: DraggableItem) => void` | Called when a new item is created |
| `onItemUpdate` | `(item: DraggableItem) => void` | Called when an item is updated (e.g., moved) |

## Types

### DraggableItem

```typescript
interface DraggableItem {
  id: string;
  emoji: string;
  data: string;
  x: number;
  y: number;
  type?: 'key' | 'lock' | 'soul';
  encrypted?: boolean;
  secretType?: string;
}
```

## Styling

The widget comes with default styling in `KeyforgeWidget.css`. You can override these styles by targeting the following classes:

- `.forge-container`: Main container
- `.context-menu`: Right-click menu
- `.context-menu-item`: Menu items
- `.draggable`: Draggable items (keys, locks)
- `.metadata`: Hover information display
- `.status-message`: Temporary status messages

### Example Style Override

```css
.forge-container {
  max-width: 1200px; /* Wider container */
}

.draggable {
  font-size: 64px; /* Larger items */
}
```

## Technical Details

### Encryption

The widget uses a simple XOR-based encryption system with the following features:
- Data is JSON stringified
- URI encoded to handle special characters
- XOR encrypted with the key
- Base64 encoded for safe storage

### Drag and Drop

The drag and drop system uses:
- React's synthetic events for initialization
- Window events for smooth dragging
- Transform-based positioning for performance
- Request Animation Frame for smooth updates

## Performance Considerations

1. Uses `will-change` transform for GPU acceleration
2. Implements drag throttling
3. Uses CSS transitions for smooth animations
4. Cleanup of event listeners on unmount

## Browser Support

Requires browsers with support for:
- Web Crypto API
- CSS transforms
- CSS transitions
- Modern JavaScript features

## Troubleshooting

1. **Items not dragging smoothly**
   - Check if there are conflicting event listeners
   - Ensure transform transitions are working

2. **Context menu not appearing**
   - Verify right-click isn't being prevented by parent elements
   - Check z-index conflicts

3. **Encryption errors**
   - Ensure Web Crypto API is available
   - Check for invalid characters in data

## Future Improvements

1. Add soul creation functionality
2. Implement key-lock matching system
3. Add animation effects for interactions
4. Include sound effects
5. Add touch support for mobile devices
