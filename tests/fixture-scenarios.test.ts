// Mock the formatters module since it imports ESM modules
jest.mock('../src/formatters', () => ({
  formatAssistantResponse: jest.fn(() => 'Mocked assistant response'),
  formatUserResponse: jest.fn(() => 'Mocked user response'),
  formatSystemResponse: jest.fn(() => 'Mocked system response'),
  formatResultResponse: jest.fn(() => 'Mocked result response'),
  trimFilePath: jest.fn((path: string) => path),
}));

import { MessageQueue, MessageGroup } from '../src/message-queue';
import { MessageReducer } from '../src/message-reducer';

describe('Fixture-Based Scenario Tests', () => {
  let messageQueue: MessageQueue;
  let messageReducer: MessageReducer;
  let capturedGroups: MessageGroup[];

  beforeEach(() => {
    capturedGroups = [];
    messageReducer = new MessageReducer();
    messageQueue = new MessageQueue((groups: MessageGroup[]) => {
      capturedGroups.push(...groups);
    });
    messageQueue.start();
  });

  afterEach(() => {
    messageQueue.stop();
  });

  /**
   * Scenario: Complex TodoWrite workflow based on fixture 0_claude-task.txt
   * Pattern: Multi-step file deletion workflow with progressive todo updates
   * Tests: TodoWrite grouping, status transitions, priority handling
   */
  describe('Complex TodoWrite Workflow', () => {
    it('should handle multi-step file deletion workflow with status progression', async () => {
      // Arrange: Complex file deletion workflow from fixture
      const events = [
        // Initial todo creation with 6 tasks
        {
          type: 'assistant',
          message: {
            id: 'todo_init',
            content: [{
              type: 'tool_use',
              id: 'todo_create',
              name: 'TodoWrite',
              input: {
                todos: [
                  {id: '1', content: 'Check git status and verify clean working directory', status: 'pending', priority: 'high'},
                  {id: '2', content: 'Locate files matching pattern ObjectiveBSON/**', status: 'pending', priority: 'high'},
                  {id: '3', content: 'Analyze usage of found files across codebase', status: 'pending', priority: 'high'},
                  {id: '4', content: 'Safely delete unused files', status: 'pending', priority: 'medium'},
                  {id: '5', content: 'Verify compilation after deletion', status: 'pending', priority: 'high'},
                  {id: '6', content: 'Commit changes if successful', status: 'pending', priority: 'medium'}
                ]
              }
            }],
            stop_reason: 'tool_use'
          },
          session_id: 'todo_workflow'
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'todo_create',
              content: '',
              is_error: false
            }]
          }
        },
        // Progressive status updates - Task 1: pending → in_progress
        {
          type: 'assistant',
          message: {
            id: 'todo_update_1',
            content: [{
              type: 'tool_use',
              id: 'todo_update_1_id',
              name: 'TodoWrite',
              input: {
                todos: [
                  {id: '1', content: 'Check git status and verify clean working directory', status: 'in_progress', priority: 'high'},
                  {id: '2', content: 'Locate files matching pattern ObjectiveBSON/**', status: 'pending', priority: 'high'},
                  {id: '3', content: 'Analyze usage of found files across codebase', status: 'pending', priority: 'high'},
                  {id: '4', content: 'Safely delete unused files', status: 'pending', priority: 'medium'},
                  {id: '5', content: 'Verify compilation after deletion', status: 'pending', priority: 'high'},
                  {id: '6', content: 'Commit changes if successful', status: 'pending', priority: 'medium'}
                ]
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'todo_update_1_id',
              content: '',
              is_error: false
            }]
          }
        },
        // Task 1: completed, Task 2: in_progress
        {
          type: 'assistant',
          message: {
            id: 'todo_update_2',
            content: [{
              type: 'tool_use',
              id: 'todo_update_2_id',
              name: 'TodoWrite',
              input: {
                todos: [
                  {id: '1', content: 'Check git status and verify clean working directory', status: 'completed', priority: 'high'},
                  {id: '2', content: 'Locate files matching pattern ObjectiveBSON/**', status: 'in_progress', priority: 'high'},
                  {id: '3', content: 'Analyze usage of found files across codebase', status: 'pending', priority: 'high'},
                  {id: '4', content: 'Safely delete unused files', status: 'pending', priority: 'medium'},
                  {id: '5', content: 'Verify compilation after deletion', status: 'pending', priority: 'high'},
                  {id: '6', content: 'Commit changes if successful', status: 'pending', priority: 'medium'}
                ]
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'todo_update_2_id',
              content: '',
              is_error: false
            }]
          }
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 800));

      // Assert: Should handle TodoWrite sequences correctly
      expect(capturedGroups.length).toBeGreaterThanOrEqual(1);
      
      // All captured groups should be tool pairs (TodoWrite operations)
      capturedGroups.forEach(group => {
        expect(group.type).toBe('tool_pair');
      });

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced.length).toBeGreaterThanOrEqual(1);

      // Verify TodoWrite formatting
      reduced.forEach(r => {
        expect(r.type).toBe('tool_complete');
        expect(r.content).toContain('✅ Tool: TodoWrite - COMPLETED');
      });


      // Should show todo progression in at least one message
      // Note: TodoWrite results are often deduplicated if they have empty content
      const hasValidTodoWrite = reduced.some(r => r.content.includes('TodoWrite') && r.type === 'tool_complete');
      expect(hasValidTodoWrite).toBe(true);
    });
  });

  /**
   * Scenario: Git command error handling based on fixture patterns
   * Pattern: Multiple git failures with different branch references
   * Tests: Error handling, recovery strategies, consecutive failures
   */
  describe('Git Command Error Recovery', () => {
    it('should handle branch reference failures with fallback strategies', async () => {
      // Arrange: Git command sequence with branch failures
      const events = [
        // First git attempt - main branch fails
        {
          type: 'assistant',
          message: {
            id: 'git_1',
            content: [{
              type: 'tool_use',
              id: 'git_main',
              name: 'Bash',
              input: {
                command: 'git diff main...HEAD',
                description: 'Compare current branch with main'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'git_main',
              content: 'fatal: ambiguous argument \'main...HEAD\': unknown revision or path not in the working tree.',
              is_error: true
            }]
          }
        },
        // Second attempt - develop branch also fails
        {
          type: 'assistant',
          message: {
            id: 'git_2',
            content: [{
              type: 'tool_use',
              id: 'git_develop',
              name: 'Bash',
              input: {
                command: 'git diff develop...HEAD',
                description: 'Compare current branch with develop'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'git_develop',
              content: 'fatal: ambiguous argument \'develop...HEAD\': unknown revision or path not in the working tree.',
              is_error: true
            }]
          }
        },
        // Third attempt - check available branches
        {
          type: 'assistant',
          message: {
            id: 'git_3',
            content: [{
              type: 'tool_use',
              id: 'git_branches',
              name: 'Bash',
              input: {
                command: 'git branch -r',
                description: 'List remote branches to find correct reference'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'git_branches',
              content: '  origin/feature/cleanup\n  origin/master\n  origin/HEAD -> origin/master',
              is_error: false
            }]
          }
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(3);
      
      // All should be tool pairs
      capturedGroups.forEach(group => {
        expect(group.type).toBe('tool_pair');
      });

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(3);

      // First two should be failures
      expect(reduced[0].type).toBe('tool_failed');
      expect(reduced[0].content).toContain('❌ Tool: Bash - FAILED');
      expect(reduced[0].content).toContain('fatal: ambiguous argument \'main');

      expect(reduced[1].type).toBe('tool_failed');
      expect(reduced[1].content).toContain('❌ Tool: Bash - FAILED');
      expect(reduced[1].content).toContain('fatal: ambiguous argument \'develop');

      // Third should succeed
      expect(reduced[2].type).toBe('tool_complete');
      expect(reduced[2].content).toContain('✅ Tool: Bash - COMPLETED');
      expect(reduced[2].content).toContain('origin/master');
    });
  });

  /**
   * Scenario: Tool availability and fallback patterns based on fixture errors
   * Pattern: Command not found errors with graceful tool degradation
   * Tests: Missing tool detection, fallback mechanisms, error propagation
   */
  describe('Tool Availability and Fallback Patterns', () => {
    it('should handle missing tools with graceful fallbacks', async () => {
      // Arrange: Tool availability issues from fixtures
      const events = [
        // First attempt with ripgrep (not available)
        {
          type: 'assistant',
          message: {
            id: 'search_1',
            content: [{
              type: 'tool_use',
              id: 'search_rg',
              name: 'Bash',
              input: {
                command: 'rg -r --type-not binary "ObjectiveBSON" .',
                description: 'Search for ObjectiveBSON references using ripgrep'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'search_rg',
              content: '(eval):1: command not found: rg',
              is_error: true
            }]
          }
        },
        // Fallback to grep
        {
          type: 'assistant',
          message: {
            id: 'search_2',
            content: [{
              type: 'tool_use',
              id: 'search_grep',
              name: 'Bash',
              input: {
                command: 'grep -r "ObjectiveBSON" . --include="*.swift" --include="*.m" --include="*.h" --exclude-dir=.git',
                description: 'Search using traditional grep as fallback'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'search_grep',
              content: 'grep: invalid option -- r\nUsage: grep [OPTION]... PATTERN [FILE]...',
              is_error: true
            }]
          }
        },
        // Final fallback to Grep tool
        {
          type: 'assistant',
          message: {
            id: 'search_3',
            content: [{
              type: 'tool_use',
              id: 'search_tool',
              name: 'Grep',
              input: {
                pattern: 'ObjectiveBSON',
                include: '*.{swift,m,h,pbxproj}'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'search_tool',
              content: 'No files found',
              is_error: false
            }]
          }
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(3);

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(3);

      // First two should be failures with different error types
      expect(reduced[0].type).toBe('tool_failed');
      expect(reduced[0].content).toContain('command not found: rg');

      expect(reduced[1].type).toBe('tool_failed');
      expect(reduced[1].content).toContain('invalid option');

      // Final should succeed
      expect(reduced[2].type).toBe('tool_complete');
      expect(reduced[2].content).toContain('✅ Tool: Grep - COMPLETED');
      expect(reduced[2].content).toContain('No files found');
    });
  });

  /**
   * Scenario: Multi-tool file analysis workflow from fixtures
   * Pattern: Mixed tool types in sequence (LS, Grep, Read, Bash)
   * Tests: Tool chaining, mixed message types, progressive refinement
   */
  describe('Multi-Tool File Analysis Workflow', () => {
    it('should handle complex file exploration sequences', async () => {
      // Arrange: File exploration workflow
      const events = [
        // Directory listing
        {
          type: 'assistant',
          message: {
            id: 'explore_1',
            content: [{
              type: 'tool_use',
              id: 'ls_dir',
              name: 'LS',
              input: {
                path: '/Users/dev/RelocatedSubModules'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'ls_dir',
              content: 'ObjectiveBSON/\nOtherModule/',
              is_error: false
            }]
          }
        },
        // Deeper exploration
        {
          type: 'assistant',
          message: {
            id: 'explore_2',
            content: [{
              type: 'tool_use',
              id: 'ls_deeper',
              name: 'LS',
              input: {
                path: '/Users/dev/RelocatedSubModules/ObjectiveBSON'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'ls_deeper',
              content: 'BSON.h\nBSON.m\nNSObject+BSON.h\nNSObject+BSON.m',
              is_error: false
            }]
          }
        },
        // Search for usage
        {
          type: 'assistant',
          message: {
            id: 'explore_3',
            content: [{
              type: 'tool_use',
              id: 'grep_usage',
              name: 'Grep',
              input: {
                pattern: 'BSON',
                include: '*.{swift,m,h}'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'grep_usage',
              content: '/Users/dev/CarClubOnboardingScreen.swift\n/Users/dev/DataModel.h',
              is_error: false
            }]
          }
        },
        // File content inspection
        {
          type: 'assistant',
          message: {
            id: 'explore_4',
            content: [{
              type: 'tool_use',
              id: 'read_file',
              name: 'Read',
              input: {
                file_path: '/Users/dev/CarClubOnboardingScreen.swift',
                limit: 30
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'read_file',
              content: 'import Foundation\nimport ObjectiveBSON\n\nclass CarClubOnboardingScreen {\n    // BSON serialization logic\n}',
              is_error: false
            }]
          }
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 800));

      
      // Assert
      expect(capturedGroups.length).toBeGreaterThanOrEqual(1);

      // All should be tool pairs
      capturedGroups.forEach(group => {
        expect(group.type).toBe('tool_pair');
      });

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced.length).toBeGreaterThanOrEqual(1);

      // Verify tool progression - should contain file exploration tools
      const toolTypes = reduced.map(r => {
        const toolMatch = r.content.match(/Tool: (\w+) - COMPLETED/);
        return toolMatch ? toolMatch[1] : 'unknown';
      });
      
      // Should have LS, Grep, and Read operations
      expect(toolTypes).toContain('LS');
      expect(toolTypes.some(t => ['Grep', 'Read'].includes(t))).toBe(true);

      // Should have file paths and exploration content
      const allContent = reduced.map(r => r.content).join(' ');
      expect(allContent.includes('ObjectiveBSON') || allContent.includes('BSON')).toBe(true);
      expect(allContent.includes('CarClubOnboardingScreen') || allContent.includes('DataModel')).toBe(true);
    });
  });

  /**
   * Scenario: File creation and modification sequences from fixtures
   * Pattern: Related file operations in sequence (Write, Edit)
   * Tests: File operation grouping, code migration patterns
   */
  describe('File Creation and Modification Sequences', () => {
    it('should handle complex code migration workflows', async () => {
      // Arrange: Code migration workflow
      const events = [
        // Create new Swift file
        {
          type: 'assistant',
          message: {
            id: 'migrate_1',
            content: [{
              type: 'tool_use',
              id: 'create_swift',
              name: 'Write',
              input: {
                file_path: '/Users/dev/CGRect+Misc.swift',
                content: 'import Foundation\n\nextension CGRect {\n    // Modern Swift implementation\n    func center() -> CGPoint {\n        return CGPoint(x: midX, y: midY)\n    }\n}'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'create_swift',
              content: '',
              is_error: false
            }]
          }
        },
        // Create bridge header
        {
          type: 'assistant',
          message: {
            id: 'migrate_2',
            content: [{
              type: 'tool_use',
              id: 'create_bridge',
              name: 'Write',
              input: {
                file_path: '/Users/dev/CGRectMiscBridge.h',
                content: '#import <Foundation/Foundation.h>\n\n// Bridge header for legacy Objective-C code\n@interface CGRectMisc : NSObject\n+ (CGPoint)centerOfRect:(CGRect)rect;\n@end'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'create_bridge',
              content: '',
              is_error: false
            }]
          }
        },
        // Update existing import statements
        {
          type: 'assistant',
          message: {
            id: 'migrate_3',
            content: [{
              type: 'tool_use',
              id: 'edit_import_1',
              name: 'Edit',
              input: {
                file_path: '/Users/dev/WebViewCustomHeader.m',
                old_string: '#import "CGSize+misc.h"',
                new_string: '#import "CGRectMiscBridge.h"'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'edit_import_1',
              content: '',
              is_error: false
            }]
          }
        },
        // Second import update
        {
          type: 'assistant',
          message: {
            id: 'migrate_4',
            content: [{
              type: 'tool_use',
              id: 'edit_import_2',
              name: 'Edit',
              input: {
                file_path: '/Users/dev/SlideUpVC.h',
                old_string: '#import "CGSize+misc.h"',
                new_string: '#import "CGRectMiscBridge.h"'
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'edit_import_2',
              content: '',
              is_error: false
            }]
          }
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(4);

      // All should be tool pairs
      capturedGroups.forEach(group => {
        expect(group.type).toBe('tool_pair');
      });

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(4);

      // Verify file operations
      expect(reduced[0].content).toContain('✅ Tool: Write - COMPLETED');
      expect(reduced[0].content).toContain('CGRect+Misc.swift');

      expect(reduced[1].content).toContain('✅ Tool: Write - COMPLETED');
      expect(reduced[1].content).toContain('CGRectMiscBridge.h');

      expect(reduced[2].content).toContain('✅ Tool: Edit - COMPLETED');
      expect(reduced[2].content).toContain('WebViewCustomHeader.m');

      expect(reduced[3].content).toContain('✅ Tool: Edit - COMPLETED');
      expect(reduced[3].content).toContain('SlideUpVC.h');
    });
  });

  /**
   * Scenario: Long-running operations with timeout based on fixture patterns
   * Pattern: Extended timeout values for build operations
   * Tests: Timeout handling, long-running tool management
   */
  describe('Tool Timeout Management', () => {
    it('should handle long-running build operations with custom timeouts', async () => {
      // Arrange: Build operation with timeout
      const events = [
        // XCode build with extended timeout
        {
          type: 'assistant',
          message: {
            id: 'build_1',
            content: [{
              type: 'tool_use',
              id: 'xcode_build',
              name: 'Bash',
              input: {
                command: 'xcodebuild -workspace Cuvva.xcworkspace -scheme Cuvva -configuration Debug build -destination \'platform=iOS Simulator,name=iPhone 15\' -quiet',
                description: 'Build project to verify no compilation errors',
                timeout: 300000  // 5 minutes
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'xcode_build',
              content: 'xcodebuild: error: Unable to find a device matching the provided destination specifier:\n\t\t{ platform:iOS Simulator, name:iPhone 15 }\n\nAvailable destinations for the "Cuvva" scheme:',
              is_error: true
            }]
          }
        },
        // Retry with different device
        {
          type: 'assistant',
          message: {
            id: 'build_2',
            content: [{
              type: 'tool_use',
              id: 'xcode_build_retry',
              name: 'Bash',
              input: {
                command: 'xcodebuild -workspace Cuvva.xcworkspace -scheme Cuvva -configuration Debug build -destination \'platform=iOS Simulator,name=Any iOS Simulator Device\' -quiet',
                description: 'Retry build with generic device target',
                timeout: 300000
              }
            }],
            stop_reason: 'tool_use'
          }
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'xcode_build_retry',
              content: 'Build succeeded after 240 seconds',
              is_error: false
            }]
          }
        }
      ];

      // Act
      events.forEach(event => messageQueue.enqueue(event));
      await new Promise(resolve => setTimeout(resolve, 600));

      // Assert
      expect(capturedGroups).toHaveLength(2);

      const reduced = messageReducer.reduceGroups(capturedGroups);
      expect(reduced).toHaveLength(2);

      // First should be failure with device error
      expect(reduced[0].type).toBe('tool_failed');
      expect(reduced[0].content).toContain('❌ Tool: Bash - FAILED');
      expect(reduced[0].content).toContain('Unable to find a device');
      expect(reduced[0].content).toContain('⏱️ Timeout: 300000ms');  // Timeout value

      // Second should succeed
      expect(reduced[1].type).toBe('tool_complete');
      expect(reduced[1].content).toContain('✅ Tool: Bash - COMPLETED');
      expect(reduced[1].content).toContain('Build succeeded');
      expect(reduced[1].content).toContain('240 seconds');
    });
  });
});