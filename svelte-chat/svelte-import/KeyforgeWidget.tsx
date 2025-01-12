import React, { useEffect, useRef, useState } from 'react';
import './KeyforgeWidget.css';

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

interface KeyforgeWidgetProps {
  onItemCreate?: (item: DraggableItem) => void;
  onItemUpdate?: (item: DraggableItem) => void;
}

const ENCODINGS = {
  'a': 'ascii',
  'u': 'utf8',
  'b': 'base64',
  'h': 'hex'
};

const KeyforgeWidget: React.FC<KeyforgeWidgetProps> = ({ onItemCreate, onItemUpdate }) => {
  const [items, setItems] = useState<DraggableItem[]>([]);
  const [activeDraggable, setActiveDraggable] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const dragStartTime = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

  const generateId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

  const generateKeyString = () => {
    const encoding = Object.keys(ENCODINGS)[Math.floor(Math.random() * Object.keys(ENCODINGS).length)];
    return `{${encoding}${generateId()}}`;
  };

  const showStatus = (message: string, duration = 2000) => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(''), duration);
  };

  const encryptData = (data: any, keyString: string): string | null => {
    try {
      const jsonStr = JSON.stringify(data);
      const encodedData = btoa(encodeURIComponent(jsonStr));
      const encrypted = encodedData
        .split('')
        .map((char, i) => {
          const keyChar = keyString[i % keyString.length];
          return String.fromCharCode(char.charCodeAt(0) ^ keyChar.charCodeAt(0));
        })
        .join('');
      return btoa(encrypted);
    } catch (e) {
      console.error('Encryption error:', e);
      return null;
    }
  };

  const createKey = (x: number, y: number) => {
    const keyString = generateKeyString();
    const newItem: DraggableItem = {
      id: generateId(),
      emoji: '🔑',
      data: keyString,
      x,
      y,
      type: 'key'
    };
    setItems(prev => [...prev, newItem]);
    onItemCreate?.(newItem);
    showStatus('Key forged! 🔑');
  };

  const createLock = (x: number, y: number) => {
    const keyString = generateKeyString();
    const lockData = {
      id: generateId(),
      content: "Secret chest content",
      created: new Date().toISOString()
    };
    
    const encryptedData = encryptData(lockData, keyString);
    if (!encryptedData) return;

    const newLock: DraggableItem = {
      id: generateId(),
      emoji: '🔒',
      data: encryptedData,
      x,
      y,
      type: 'lock',
      encrypted: true
    };

    const angle = Math.random() * 2 * Math.PI;
    const distance = 150 + Math.random() * 50;
    const keyX = x + Math.cos(angle) * distance;
    const keyY = y + Math.sin(angle) * distance;

    const newKey: DraggableItem = {
      id: generateId(),
      emoji: '🔑',
      data: keyString,
      x: keyX,
      y: keyY,
      type: 'key'
    };

    setItems(prev => [...prev, newLock, newKey]);
    onItemCreate?.(newLock);
    onItemCreate?.(newKey);
    showStatus('Chest created with matching key! 🔒');
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleClick = () => {
    setContextMenu(null);
  };

  const handleDragStart = (id: string, e: React.MouseEvent) => {
    setActiveDraggable(id);
    dragStartTime.current = Date.now();
    isDragging.current = false;
  };

  const handleDragMove = (e: MouseEvent) => {
    if (!activeDraggable) return;

    isDragging.current = true;
    const item = items.find(i => i.id === activeDraggable);
    if (!item) return;

    const updatedItem = {
      ...item,
      x: e.clientX,
      y: e.clientY
    };

    setItems(prev => prev.map(i => i.id === activeDraggable ? updatedItem : i));
    onItemUpdate?.(updatedItem);
  };

  const handleDragEnd = () => {
    setActiveDraggable(null);
    isDragging.current = false;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => handleDragMove(e);
    const handleMouseUp = () => handleDragEnd();

    if (activeDraggable) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDraggable]);

  return (
    <div className="forge-container" onClick={handleClick} onContextMenu={handleContextMenu}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`draggable ${activeDraggable === item.id ? 'dragging' : ''}`}
          style={{ left: item.x, top: item.y }}
          onMouseDown={(e) => handleDragStart(item.id, e)}
        >
          {item.emoji}
          <div className="metadata">
            {item.data}
          </div>
        </div>
      ))}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="context-menu-item" onClick={() => {
            createLock(contextMenu.x, contextMenu.y);
            setContextMenu(null);
          }}>
            🔒 Create Lock
          </div>
          <div className="context-menu-item" onClick={() => {
            createKey(contextMenu.x, contextMenu.y);
            setContextMenu(null);
          }}>
            🔑 Create Key
          </div>
        </div>
      )}

      {statusMessage && (
        <div className={`status-message ${statusMessage ? 'show' : ''}`}>
          {statusMessage}
        </div>
      )}
    </div>
  );
};

export default KeyforgeWidget;
