import { extractJsonSync } from '@axync/extract-json/dist/internal/extract-json.js';
import { Message } from './models';

export class InputParser {
    private buffer = '';
    private braceCount = 0;
    private currentJsonStart = -1;
    
    /**
     * Parse a line of input and extract any complete JSON objects
     */
    parseLine(line: string): Message[] {
        const messages: Message[] = [];
        
        // Add line to buffer 
        this.buffer += line + '\n';
        
        // Extract all complete JSON objects from the buffer
        let startPos = 0;
        while (startPos < this.buffer.length) {
            try {
                // Find the start of a JSON object
                const jsonStart = this.buffer.indexOf('{', startPos);
                if (jsonStart === -1) break;
                
                // Try to extract JSON starting from this position
                const remainingBuffer = this.buffer.substring(jsonStart);
                const extracted = extractJsonSync(remainingBuffer);
                
                if (extracted.length > 0) {
                    const parsed = extracted[0];
                    if (this.isValidMessage(parsed)) {
                        messages.push(parsed as Message);
                    }
                    
                    // Find where this JSON object ends and continue from there
                    const jsonStr = JSON.stringify(parsed);
                    const endPos = jsonStart + remainingBuffer.indexOf(jsonStr) + jsonStr.length;
                    
                    // Move past this JSON object
                    startPos = endPos;
                    
                    // Remove the processed JSON from the buffer
                    this.buffer = this.buffer.substring(0, jsonStart) + this.buffer.substring(endPos);
                    startPos = jsonStart; // Reset to check for more JSON at the same position
                } else {
                    // No valid JSON found, move to next character
                    startPos = jsonStart + 1;
                }
            } catch (e) {
                // Move to next character if parsing fails
                startPos = this.buffer.indexOf('{', startPos) + 1;
                if (startPos === 0) break; // No more '{' found
            }
        }
        
        return messages;
    }
    
    /**
     * Validate that an object is a valid Message
     */
    private isValidMessage(obj: any): boolean {
        return obj && 
               typeof obj === 'object' && 
               'type' in obj &&
               ['assistant', 'user', 'system', 'result'].includes(obj.type);
    }
    
    /**
     * Reset the parser state
     */
    reset(): void {
        this.buffer = '';
        this.braceCount = 0;
        this.currentJsonStart = -1;
    }
}