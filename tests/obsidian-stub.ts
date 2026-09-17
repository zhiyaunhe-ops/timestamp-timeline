/**
 * Minimal stand-in for the `obsidian` module so the plugin's pure logic can be
 * exercised in plain Node. Only what llm.ts / context.ts actually touch.
 */
export async function requestUrl(params: any) {
  const res = await fetch(params.url, {
    method: params.method ?? 'GET',
    headers: params.headers,
    body: params.body,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (params.throw !== false && res.status >= 400) {
    throw new Error(`Request failed, status ${res.status}`);
  }
  return { status: res.status, text, json, headers: {} };
}

export class Notice {
  constructor(public message: string) {}
}

export class TFile {
  constructor(public path = '', public basename = '', public extension = 'md') {}
  parent: any = null;
}

export class TFolder {}
export class MarkdownView {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class Component {
  load() {}
  unload() {}
}
export class ItemView {}
export class WorkspaceLeaf {}
export const MarkdownRenderer = { render: async () => {} };
export function setIcon() {}
