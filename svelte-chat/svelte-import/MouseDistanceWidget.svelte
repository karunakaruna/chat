<!-- MouseDistanceWidget.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';

    // Props
    export let updateInterval: number = 100;
    export let averageInterval: number = 1000;

    // State variables
    let lastX: number = 0;
    let lastY: number = 0;
    let lastMotion: number = 0;
    let cumulativeMovement: number = 0;
    let displayedMotion: number = 0;
    let deltaMotion: number = 0;
    let motionHistory: number[] = [];
    let averageMotion: number = 0;

    // Intervals
    let motionInterval: number;
    let averageInterval: number;

    onMount(() => {
        // Update motion delta
        motionInterval = setInterval(() => {
            lastMotion = cumulativeMovement;
        }, updateInterval);

        // Calculate average motion
        averageInterval = setInterval(() => {
            averageMotion = motionHistory.length > 0 
                ? motionHistory.reduce((a, b) => a + b, 0) / motionHistory.length 
                : 0;
            motionHistory = [];
        }, averageInterval);

        // Mouse move handler
        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - lastX;
            const deltaY = e.clientY - lastY;
            const motion = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            motionHistory.push(motion);
            cumulativeMovement += motion;

            lastX = e.clientX;
            lastY = e.clientY;

            // Update delta motion
            deltaMotion = cumulativeMovement - lastMotion;
            // Lerp towards the delta motion
            displayedMotion += (deltaMotion - displayedMotion) * 0.1;
        };

        window.addEventListener('mousemove', handleMouseMove);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            clearInterval(motionInterval);
            clearInterval(averageInterval);
        };
    });
</script>

<div class="mouse-distance-widget">
    <div class="movement-overlay">Movement: {cumulativeMovement.toFixed(2)}</div>
    <div class="average-motion-overlay">Average Motion: {displayedMotion.toFixed(2)}</div>
</div>

<style>
    .mouse-distance-widget {
        position: fixed;
        top: 20px;
        left: 20px;
        background: rgba(26, 27, 38, 0.95);
        border: 1px solid #7aa2f7;
        border-radius: 8px;
        padding: 10px;
        color: #a9b1d6;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        backdrop-filter: blur(10px);
        z-index: 1000;
    }

    .movement-overlay,
    .average-motion-overlay {
        margin: 5px 0;
    }
</style>
