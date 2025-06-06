#!/bin/bash

# Test script to verify Slack message posting

echo "Testing Slack message posting with debug mode..."
echo ""

# Enable debug mode
export CCPRETTY_DEBUG=1

# Test 1: Simple assistant message
echo "Test 1: Simple assistant message"
echo '{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"Hello, I will help you with your task."}]}}' | npm run ccpretty

sleep 2

# Test 2: Multiple assistant messages
echo -e "\n\nTest 2: Multiple assistant messages"
cat << EOF | npm run ccpretty
{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"First assistant message"}]}}
{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"Second assistant message"}]}}
{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"Third assistant message"}]}}
{"type":"result","subtype":"success","duration_ms":1000,"cost_usd":0.01}
EOF

sleep 2

# Test 3: Tool use and result
echo -e "\n\nTest 3: Tool use and result"
cat << EOF | npm run ccpretty
{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"tool_use","id":"tool1","name":"Read","input":{"file_path":"/test.txt"}}]}}
{"type":"user","message":{"type":"message","role":"user","content":[{"type":"tool_result","tool_use_id":"tool1","content":"File contents here"}]}}
{"type":"result","subtype":"success","duration_ms":2000,"cost_usd":0.02}
EOF

sleep 2

# Test 4: Mixed content
echo -e "\n\nTest 4: Mixed text and tool use"
cat << EOF | npm run ccpretty
{"type":"system","subtype":"init","session_id":"test-session-123","tools":["Read","Write","Edit"]}
{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"I'll read the file for you."},{"type":"tool_use","id":"tool2","name":"Read","input":{"file_path":"/example.txt"}}]}}
{"type":"user","message":{"type":"message","role":"user","content":[{"type":"tool_result","tool_use_id":"tool2","content":"Example file contents"}]}}
{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"The file contains example content. Let me process it."}]}}
{"type":"result","subtype":"success","duration_ms":3000,"cost_usd":0.03}
EOF

echo -e "\n\nDone testing. Check debug output above for message flow."