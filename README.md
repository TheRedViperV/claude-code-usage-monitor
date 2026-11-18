# Token Meter for Claude Code

![Token Meter above the Claude Code prompt: Session 71%, Weekly 51%, Context 17%](assets/screenshot-bar.png)

A live usage bar above the chat box in Claude Code. It shows three things at a glance, each with an activity ring that turns from green to amber to red as it fills:

- **Session**: your 5-hour usage limit, with the time until it resets
- **Weekly**: your 7-day usage limit, with the time until it resets
- **Context**: how full the current chat's context window is

Session and Weekly limits belong to your account, so every open chat shows the latest figures, even one you haven't sent a message in yet. The bar adapts to the window width. Limits appear on Claude subscription plans (Pro, Max); with an API key only Context is shown.

## Install

**Claude desktop app (Code tab):** click **+** next to the prompt box, then **Plugins** → **Add marketplace**, enter `TheRedViperV/claude-token-meter`, then **Add plugin** and pick **token-meter**.

**Claude Code in a terminal**, at the prompt:

```
/plugin install token-meter --marketplace TheRedViperV/claude-token-meter
```

Answer `y` to add the marketplace, then choose the user scope so it appears in every session.

**From a shell:**

```
claude plugin install token-meter --marketplace TheRedViperV/claude-token-meter
```

## License

MIT
