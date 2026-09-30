# An agent mention is dispatched by the current agent

Sending a message with an **Agent mention** does not start the subagent from the app or the daemon. The message goes to the current agent as usual, the daemon appends a routing block naming each mentioned provider with a resolved model and mode, and the current agent starts one subagent per mention through `create_agent`. Only the current agent has read the conversation, so only it can write each subagent a task that stands on its own, and only it can merge the results when the finish notices come back. codeg works the same way.

## Considered Options

- The daemon starts one subagent per mention and sends each the user's raw message. Rejected: the subagents never see the conversation the message refers to, and nothing splits the work or collects the results.

## Consequences

- Dispatch depends on the current agent following the routing block. v1 does not check whether it did; a mention without a matching subagent card is how the user notices.
- Dispatch needs Osuna tools in the current agent's session. Without them, the `@` agent group is disabled instead of hidden.
