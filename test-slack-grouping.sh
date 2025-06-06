#!/bin/bash

# Test script to verify Slack message grouping functionality

# Create test JSON messages for consecutive assistant messages
echo 'Testing consecutive assistant messages...'
echo '{"type": "system", "message": {"type": "init"}, "session_id": "test-123", "tools": ["Read", "Write", "Bash"]}' | npm run ccpretty
sleep 2

echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "text", "text": "First assistant message"}]}}' | npm run ccpretty
sleep 1

echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "text", "text": "Second assistant message - should be grouped"}]}}' | npm run ccpretty
sleep 1

echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "text", "text": "Third assistant message - should also be grouped"}]}}' | npm run ccpretty
sleep 2

# Test consecutive tool use messages
echo 'Testing consecutive tool use messages...'
echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "tool_use", "id": "tool1", "name": "Read", "input": {"file_path": "/test/file1.txt"}}]}}' | npm run ccpretty
sleep 1

echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "tool_use", "id": "tool2", "name": "Write", "input": {"file_path": "/test/file2.txt", "content": "test"}}]}}' | npm run ccpretty
sleep 1

echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "tool_use", "id": "tool3", "name": "Bash", "input": {"command": "ls -la", "description": "List files"}}]}}' | npm run ccpretty
sleep 2

# Test mixed message types (should NOT be grouped)
echo 'Testing mixed message types...'
echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "text", "text": "Assistant message"}]}}' | npm run ccpretty
sleep 1

echo '{"type": "user", "message": {"type": "message", "content": [{"type": "tool_result", "tool_use_id": "tool1", "content": "Result data"}]}}' | npm run ccpretty
sleep 1

echo '{"type": "assistant", "message": {"type": "message", "content": [{"type": "text", "text": "New assistant message - should NOT be grouped with previous"}]}}' | npm run ccpretty
sleep 2

# Test result message
echo '{"type": "result", "subtype": "success", "is_error": false, "duration_ms": 5000, "duration_api_ms": 3000, "cost_usd": 0.0123, "num_turns": 3}' | npm run ccpretty

echo 'Test complete!'