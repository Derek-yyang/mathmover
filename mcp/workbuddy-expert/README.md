# MathMover WorkBuddy Expert

This directory is the source template for the WorkBuddy Expert named
`mathmover-builder`.

The distributed Expert contains only its Agent, Skill, avatar and manifest.
MathMover itself is installed independently from npm and connected through
the user's WorkBuddy MCP configuration. This avoids shipping a second MCP
runtime inside the Expert and ensures the Expert and Web/Desktop products use
the same independently versioned service.

The Skill checks whether the MathMover tools are available. On a machine where
they are missing, the WorkBuddy Agent runs the bundled bootstrap through its
terminal tool. The bootstrap finds WorkBuddy's Node runtime, downloads and
verifies MathMover MCP, and writes the per-user MCP configuration. The user only
approves the terminal permission when WorkBuddy asks for it.

After the automatic bootstrap reports `MATHMOVER_BOOTSTRAP=success`, the user
fully restarts WorkBuddy once and starts a new task. Developers can still use
the manual npm installation documented in the root README.

Build the Expert package:

```powershell
cd D:\Mathmover\mcp
npm run build:expert
```

Install the staged package into the current user's WorkBuddy experts directory:

```powershell
npm run install:expert
```

The build copies the existing MathMover app icon to
`avatars/mathmover.png` and creates:

```text
.expert-output/mathmover-builder/
.expert-output/mathmover-builder.zip
```

The package intentionally has no `.mcp.json`, `bin/` or `runtime/`. This keeps
the shared Expert small and prevents WorkBuddy from trying to start a second,
stale MCP process beside the npm-installed service.
