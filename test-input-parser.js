#!/usr/bin/env node

/**
 * Test script to validate that all fixture logs can be parsed correctly
 * with the new InputParser
 */

const fs = require('fs');
const path = require('path');
const { InputParser } = require('./dist/input-parser');

// ANSI color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function logBold(color, message) {
  console.log(`${colors.bold}${color}${message}${colors.reset}`);
}

async function testFixture(filePath) {
  const fileName = path.basename(filePath);
  log(colors.blue, `\n📄 Testing: ${fileName}`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    const parser = new InputParser();
    let totalMessages = 0;
    let totalLines = 0;
    let errorCount = 0;
    const messageTypes = new Set();
    
    // Process each line through the parser
    for (const line of lines) {
      totalLines++;
      
      try {
        const messages = parser.parseLine(line);
        totalMessages += messages.length;
        
        // Track message types
        messages.forEach(msg => {
          if (msg.type) {
            messageTypes.add(msg.type);
          }
        });
      } catch (error) {
        errorCount++;
        console.error(`  ❌ Error on line ${totalLines}: ${error.message}`);
      }
    }
    
    // Summary for this file
    log(colors.green, `  ✅ Processed ${totalLines} lines`);
    log(colors.green, `  📦 Extracted ${totalMessages} JSON messages`);
    log(colors.green, `  📝 Message types: ${Array.from(messageTypes).join(', ')}`);
    
    if (errorCount > 0) {
      log(colors.yellow, `  ⚠️  ${errorCount} parsing errors`);
    }
    
    return {
      fileName,
      success: errorCount === 0,
      totalLines,
      totalMessages,
      errorCount,
      messageTypes: Array.from(messageTypes)
    };
    
  } catch (error) {
    log(colors.red, `  ❌ Failed to read file: ${error.message}`);
    return {
      fileName,
      success: false,
      error: error.message
    };
  }
}

async function main() {
  logBold(colors.blue, '🧪 Input Parser Fixture Test Suite');
  logBold(colors.blue, '=====================================');
  
  const fixturesDir = path.join(__dirname, 'fixtures');
  
  try {
    const files = fs.readdirSync(fixturesDir);
    const logFiles = files.filter(file => 
      file.endsWith('.log') || file.endsWith('.txt')
    ).sort();
    
    if (logFiles.length === 0) {
      log(colors.yellow, 'No log files found in fixtures directory');
      process.exit(1);
    }
    
    log(colors.blue, `Found ${logFiles.length} fixture files to test`);
    
    const results = [];
    
    // Test each fixture file
    for (const file of logFiles) {
      const filePath = path.join(fixturesDir, file);
      const result = await testFixture(filePath);
      results.push(result);
    }
    
    // Summary report
    logBold(colors.blue, '\n📊 Test Summary');
    logBold(colors.blue, '================');
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    log(colors.green, `✅ Successful: ${successful.length}`);
    if (failed.length > 0) {
      log(colors.red, `❌ Failed: ${failed.length}`);
    }
    
    // Detailed results
    logBold(colors.blue, '\n📋 Detailed Results');
    logBold(colors.blue, '===================');
    
    results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const color = result.success ? colors.green : colors.red;
      
      log(color, `${status} ${result.fileName}`);
      
      if (result.totalLines !== undefined) {
        console.log(`    Lines: ${result.totalLines}, Messages: ${result.totalMessages}`);
        if (result.messageTypes.length > 0) {
          console.log(`    Types: ${result.messageTypes.join(', ')}`);
        }
        if (result.errorCount > 0) {
          console.log(`    Errors: ${result.errorCount}`);
        }
      }
      
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
    });
    
    // Overall statistics
    const totalLines = results.reduce((sum, r) => sum + (r.totalLines || 0), 0);
    const totalMessages = results.reduce((sum, r) => sum + (r.totalMessages || 0), 0);
    const totalErrors = results.reduce((sum, r) => sum + (r.errorCount || 0), 0);
    
    logBold(colors.blue, '\n🔢 Overall Statistics');
    logBold(colors.blue, '=====================');
    log(colors.blue, `Total files processed: ${results.length}`);
    log(colors.blue, `Total lines processed: ${totalLines}`);
    log(colors.blue, `Total messages extracted: ${totalMessages}`);
    log(colors.blue, `Total parsing errors: ${totalErrors}`);
    
    // All unique message types across all files
    const allTypes = new Set();
    results.forEach(r => {
      if (r.messageTypes) {
        r.messageTypes.forEach(type => allTypes.add(type));
      }
    });
    
    if (allTypes.size > 0) {
      log(colors.blue, `Message types found: ${Array.from(allTypes).sort().join(', ')}`);
    }
    
    // Exit with appropriate code
    if (failed.length > 0) {
      logBold(colors.red, '\n❌ Some tests failed!');
      process.exit(1);
    } else {
      logBold(colors.green, '\n✅ All tests passed!');
      process.exit(0);
    }
    
  } catch (error) {
    log(colors.red, `❌ Test suite failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(colors.red, `❌ Uncaught exception: ${error.message}`);
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(colors.red, `❌ Unhandled rejection: ${reason}`);
  console.error(reason);
  process.exit(1);
});

// Run the test suite
main();