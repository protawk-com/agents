# @protawk/agents

Reusable TypeScript agent infrastructure for multi-tenant applications.

This package provides a generic agent loop, tool registry, and provider helper. Product-specific tools, prompts, and authorization stay in the consuming app.

## Setup

```bash
yarn install
yarn build
```

## Local Development

```bash
yarn dev
```

## Build And Package

```bash
yarn typecheck
yarn build
yarn pack:artifact
```

`yarn pack:artifact` creates `protawk-agents.tgz`. The package lifecycle runs a clean build before packing, so the artifact is created from current source.

## Usage

```ts
import {
  createToolRegistry,
  runAgent,
} from "@protawk/agents";
```
