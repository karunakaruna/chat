export type CloudAuthUser = {
  id: string;
  email?: string;
} | null;

export type Position = {
  x: number;
  y: number;
};

export type PolarPosition = {
  r: number;    // radius
  theta: number; // angle in radians
};

export type SpatialState = {
  position: PolarPosition;
  lastActive: number;
  cohered: boolean;
};

export type User = {
  id: string;
  username: string | null;
  avatar: string;
};

export type Message = {
  id: string;
  text: string;
  createdAt: number;
  userId: string;
};

export type ChatDocument = {
  users: User[];
  messages: Message[];
};

// Create an SHA256 hash of a string
export async function sha256(text: string) {
  // Encode the text as a Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  // Use the Web Crypto API to hash the data
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert the hash to a hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex;
}

export const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeStyle: 'short',
    dateStyle: 'medium'
  }).format(new Date(timestamp));

export const cartesianToPolar = (x: number, y: number): PolarPosition => {
  const r = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(y, x);
  return { r, theta };
};

export const polarToCartesian = (r: number, theta: number): Position => {
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  return { x, y };
};

// Normalize angle to be between -π and π
export const normalizeAngle = (angle: number): number => {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
};