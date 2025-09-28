# Stress Test - Multiple Mermaid Diagrams

This file contains multiple Mermaid diagrams to test the async rendering fix.

## Diagram 1: Flow Chart
```mermaid
graph TD
    A[Start] --> B[Process]
    B --> C[Decision]
    C -->|Yes| D[Action 1]
    C -->|No| E[Action 2]
    D --> F[End]
    E --> F
```

## Diagram 2: Sequence
```mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello Bob
    B->>A: Hi Alice
    A->>B: How are you?
    B->>A: Good, thanks!
```

## Diagram 3: State Diagram
```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Active : start
    Active --> Processing : process
    Processing --> Complete : finish
    Complete --> [*]
```

## Diagram 4: Class Diagram
```mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +bark()
    }
    class Cat {
        +meow()
    }
    Animal <|-- Dog
    Animal <|-- Cat
```

## Diagram 5: Pie Chart
```mermaid
pie title Test Results
    "Passed" : 85
    "Failed" : 10
    "Skipped" : 5
```

This file tests the async rendering fix with multiple diagrams to ensure UI responsiveness.