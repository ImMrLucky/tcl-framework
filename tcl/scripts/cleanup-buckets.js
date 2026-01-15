#!/usr/bin/env node
/**
 * Supabase Storage Buckets Cleanup Script
 * 
 * This script deletes ALL files from all Supabase Storage buckets:
 *   - protectqa-audio
 *   - protectqa-transcripts
 *   - protectqa-evidence
 *   - protectqa-exports
 * 
 * Prerequisites:
 *   - Node.js installed
 *   - @supabase/supabase-js package installed
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables set
 * 
 * Usage:
 *   SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key node tcl/scripts/cleanup-buckets.js
 * 
 * Or set them in a .env file in the project root
 */

const { createClient } = require('@supabase/supabase-js');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

// Load environment variables
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Try to load from .env file if not in environment
const envPath = join(__dirname, '..', '..', '.env');
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
  console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  console.error('\nSet them as environment variables:');
  console.error('  export SUPABASE_URL="your_supabase_url"');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"');
  console.error('\nOr add them to a .env file in the project root');
  process.exit(1);
}

// Buckets to clean
const BUCKETS = [
  'protectqa-audio',
  'protectqa-transcripts',
  'protectqa-evidence',
  'protectqa-exports',
];

/**
 * Recursively delete all files in a bucket
 */
async function cleanupBucket(supabase, bucket, path = '', deletedCount = { count: 0 }) {
  try {
    // List items in current path
    const { data: items, error } = await supabase
      .storage
      .from(bucket)
      .list(path, { 
        limit: 1000, 
        sortBy: { column: 'name', order: 'asc' },
        offset: 0
      });
    
    if (error) {
      // If error is "not found", the path doesn't exist (already cleaned or never existed)
      if (error.message && (error.message.includes('not found') || error.message.includes('Bucket not found'))) {
        return;
      }
      throw error;
    }
    
    if (!items || items.length === 0) {
      return;
    }
    
    // Separate files and folders
    const files = items.filter(item => item.id !== null);
    const folders = items.filter(item => item.id === null);
    
    // Delete all files in current directory
    if (files.length > 0) {
      const filePaths = files.map(file => 
        path ? `${path}/${file.name}` : file.name
      );
      
      // Delete in batches of 100 (Supabase limit)
      for (let i = 0; i < filePaths.length; i += 100) {
        const batch = filePaths.slice(i, i + 100);
        const { error: deleteError } = await supabase
          .storage
          .from(bucket)
          .remove(batch);
        
        if (deleteError) {
          console.error(`    ⚠️  Error deleting batch: ${deleteError.message}`);
        } else {
          deletedCount.count += batch.length;
          process.stdout.write(`    Deleted ${deletedCount.count} files...\r`);
        }
      }
    }
    
    // Recurse into subdirectories
    for (const folder of folders) {
      const folderPath = path ? `${path}/${folder.name}` : folder.name;
      await cleanupBucket(supabase, bucket, folderPath, deletedCount);
    }
  } catch (error) {
    console.error(`    ❌ Error cleaning path '${path}': ${error.message}`);
  }
}

/**
 * Main cleanup function
 */
async function cleanupAllBuckets() {
  console.log('🧹 Supabase Storage Buckets Cleanup');
  console.log('=====================================\n');
  
  // Create Supabase admin client
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  console.log('⚠️  WARNING: This will delete ALL files from the following buckets:');
  BUCKETS.forEach(bucket => console.log(`   • ${bucket}`));
  console.log('');
  
  // Confirmation prompt
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
    console.log('❌ Aborted.');
    process.exit(0);
  }
  
  console.log('\n🚀 Starting cleanup...\n');
  
  let totalDeleted = 0;
  
  for (const bucket of BUCKETS) {
    console.log(`📦 Cleaning bucket: ${bucket}`);
    
    try {
      const deletedCount = { count: 0 };
      await cleanupBucket(supabase, bucket, '', deletedCount);
      
      if (deletedCount.count === 0) {
        console.log(`   ✓ Bucket '${bucket}' is already empty\n`);
      } else {
        console.log(`   ✓ Deleted ${deletedCount.count} files from '${bucket}'\n`);
        totalDeleted += deletedCount.count;
      }
    } catch (error) {
      console.error(`   ❌ Error cleaning bucket '${bucket}': ${error.message}\n`);
    }
  }
  
  console.log('=====================================');
  if (totalDeleted > 0) {
    console.log(`✅ Cleanup complete! Deleted ${totalDeleted} files total.`);
  } else {
    console.log('✅ Cleanup complete! All buckets were already empty.');
  }
  console.log('=====================================\n');
}

// Run the cleanup
cleanupAllBuckets().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

