# ccpretty Documentation

This directory contains technical documentation for the ccpretty project.

## Available Documents

### [Architecture](./architecture.md)
Comprehensive overview of the ccpretty system architecture, including:
- System components and their relationships
- Data flow diagrams for both processing modes
- Message type hierarchy and transformations
- Integration points and configuration options
- Detailed component responsibilities

### [Message Formats](./message-formats.md)
Detailed specification of message formats, including:
- JSON structure for each message type
- Transformation examples for queue mode
- Special formatting rules (TodoWrite, errors)
- Slack Block Kit transformations
- Input/output examples for all message types

## Viewing Mermaid Diagrams

The architecture documentation uses Mermaid diagrams for visualization. To view these diagrams:

1. **GitHub**: Diagrams render automatically when viewing the markdown files
2. **VS Code**: Install the "Markdown Preview Mermaid Support" extension
3. **Other editors**: Use a markdown preview plugin with Mermaid support

## Contributing

When adding new documentation:
1. Use Mermaid diagrams to visualize complex concepts
2. Keep diagrams focused and easy to understand
3. Include both high-level overviews and detailed component views
4. Update this README with links to new documents