#!/usr/bin/env node
/**
 * Supabase Storage Cleanup Script
 * 
 * This script clears all files from Supabase Storage buckets using the Supabase Admin client
 * 
 * Prerequisites:
 *   - Node.js installed
 *   - @supabase/supabase-js package installed
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables set
 * 
 * Usage:
 *   SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/cleanup-storage.js
 * 
 * Or create a .env file with these variables
 */

// Use CommonJS for better compatibility
const { createClient } = require('@supabase/supabase-js');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

// Load environment variables
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Try to load from .env file if not in environment
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    const envVars = envContent.split('\n').reduce((acc, line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          acc[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
      return acc;
    }, {});
    
    supabaseUrl = supabaseUrl || envVars.SUPABASE_URL;
    supabaseServiceRoleKey = supabaseServiceRoleKey || envVars.SUPABASE_SERVICE_ROLE_KEY;
  } catch (e) {
    // .env file exists but couldn't be parsed, that's okay
  }
}

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  console.error('Set them as environment variables or in a .env file');
  process.exit(1);
}

// Buckets to clean
const BUCKETS = [
  'protectqa-audio',
  'protectqa-transcripts',
  'protectqa-evidence',
  'protectqa-exports',
];

async function cleanupStorage() {
  console.log('Supabase Storage Cleanup');
  console.log('========================\n');
  
  // Create Supabase admin client
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  console.log('⚠️  WARNING: This will delete ALL files from the following buckets:');
  BUCKETS.forEach(bucket => console.log(`  - ${bucket}`));
  console.log('');
  
  // Simple confirmation (for production, use readline)
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise(resolve => {
    rl.question('Are you sure you want to continue? (yes/no): ', resolve);
  });
  rl.close();
  
  if (answer.toLowerCase() !== 'yes') {
    console.log('Aborted.');
    process.exit(0);
  }
  
  console.log('\nCleaning storage buckets...\n');
  
  for (const bucket of BUCKETS) {
      console.log(`Cleaning bucket: ${bucket}`);
      
      try {
        const deletedCount = { count: 0 };
        
        // Recursively clean the entire bucket
        await cleanupBucketRecursive(supabase, bucket, '', deletedCount);
        
        if (deletedCount.count === 0) {
          console.log(`  ✓ Bucket '${bucket}' is already empty`);
        } else {
          console.log(`  ✓ Deleted ${deletedCount.count} files from '${bucket}'`);
        }
        
      } catch (error) {
        console.error(`  ✗ Error cleaning bucket '${bucket}':`, error.message);
      }
  }
  
  console.log('\n✓ Storage cleanup complete!');
}

async function cleanupBucketRecursive(supabase, bucket, path, deletedCount = { count: 0 }) {
  try {
    const { data: items, error } = await supabase
      .storage
      .from(bucket)
      .list(path, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    
    if (error) {
      // If error is "not found", the path doesn't exist (already cleaned)
      if (error.message && error.message.includes('not found')) {
        return;
      }
      throw error;
    }
    
    if (!items || items.length === 0) {
      return;
    }
    
    // Delete files first
    const filesToDelete = items
      .filter(item => item.id !== null) // Files have an id, folders don't
      .map(item => path ? `${path}/${item.name}` : item.name);
    
    if (filesToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .storage
        .from(bucket)
        .remove(filesToDelete);
      
      if (!deleteError) {
        deletedCount.count += filesToDelete.length;
      } else {
        console.error(`    Error deleting files: ${deleteError.message}`);
      }
    }
    
    // Recurse into folders
    for (const item of items) {
      if (item.id === null) {
        // It's a folder, recurse
        const itemPath = path ? `${path}/${item.name}` : item.name;
        await cleanupBucketRecursive(supabase, bucket, itemPath, deletedCount);
      }
    }
  } catch (error) {
    console.error(`    Error in cleanupBucketRecursive: ${error.message}`);
  }
}

// Run the cleanup
cleanupStorage().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

