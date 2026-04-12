#!/usr/bin/env node

/**
 * Generate tray icons with status indicators (green/red dots)
 * 
 * Creates 8 icon variants:
 * - Production: trayIconTemplate-green.png, -green@2x.png, -red.png, -red@2x.png
 * - Dev: trayIconDevTemplate-green.png, -green@2x.png, -red.png, -red@2x.png
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Image } from 'canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = join(__dirname, '../resources');

// Icon configurations
const ICONS = [
  { base: 'trayIconTemplate.png', output: 'trayIconTemplate-green.png', dotColor: '#22c55e' },
  { base: 'trayIconTemplate@2x.png', output: 'trayIconTemplate-green@2x.png', dotColor: '#22c55e', scale: 2 },
  { base: 'trayIconTemplate.png', output: 'trayIconTemplate-red.png', dotColor: '#ef4444' },
  { base: 'trayIconTemplate@2x.png', output: 'trayIconTemplate-red@2x.png', dotColor: '#ef4444', scale: 2 },
  { base: 'trayIconDevTemplate.png', output: 'trayIconDevTemplate-green.png', dotColor: '#22c55e' },
  { base: 'trayIconDevTemplate@2x.png', output: 'trayIconDevTemplate-green@2x.png', dotColor: '#22c55e', scale: 2 },
  { base: 'trayIconDevTemplate.png', output: 'trayIconDevTemplate-red.png', dotColor: '#ef4444' },
  { base: 'trayIconDevTemplate@2x.png', output: 'trayIconDevTemplate-red@2x.png', dotColor: '#ef4444', scale: 2 },
];

/**
 * Draw a solid circle on canvas
 */
function drawStatusDot(ctx, x, y, radius, color) {
  // Colored dot (solid, no outline)
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Composite base icon with status dot
 * Converts base icon to white, preserves colored dot
 */
async function createStatusIcon(baseName, outputName, dotColor, scale = 1) {
  const basePath = join(RESOURCES_DIR, baseName);
  const outputPath = join(RESOURCES_DIR, outputName);
  
  try {
    // Read base icon
    const baseData = await readFile(basePath);
    const img = new Image();
    
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = baseData;
    });
    
    const width = img.width;
    const height = img.height;
    
    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw base icon
    ctx.drawImage(img, 0, 0);
    
    // Get pixel data and convert non-transparent pixels to white
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha > 0) {
        // Convert to white, preserve alpha
        data[i] = 255;     // R
        data[i + 1] = 255; // G
        data[i + 2] = 255; // B
        // Alpha stays the same
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    // Calculate dot position (bottom-right, 2px inset)
    const dotInset = 2 * scale;
    const dotRadius = scale === 2 ? 5 : 2.5; // 5px for @2x, 2.5px for @1x
    const dotX = width - dotInset - dotRadius;
    const dotY = height - dotInset - dotRadius;
    
    // Draw colored status dot (solid, no outline)
    drawStatusDot(ctx, dotX, dotY, dotRadius, dotColor);
    
    // Write output
    const buffer = canvas.toBuffer('image/png');
    await writeFile(outputPath, buffer);
    
    console.log(`✓ Created ${outputName}`);
  } catch (error) {
    console.error(`✗ Failed to create ${outputName}:`, error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Generating tray icons with status indicators...\n');
  
  // Check if canvas is available
  try {
    await import('canvas');
  } catch {
    console.error('Error: canvas package not installed.');
    console.error('Run: npm install canvas');
    process.exit(1);
  }
  
  let successCount = 0;
  let failCount = 0;
  
  for (const config of ICONS) {
    try {
      await createStatusIcon(config.base, config.output, config.dotColor, config.scale || 1);
      successCount++;
    } catch {
      failCount++;
    }
  }
  
  console.log(`\n${successCount} icons created successfully`);
  if (failCount > 0) {
    console.log(`${failCount} icons failed`);
    process.exit(1);
  }
}

main();
