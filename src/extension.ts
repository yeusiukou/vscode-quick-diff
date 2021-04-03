import * as vscode from 'vscode';
import { API as GitAPI, GitExtension, Change } from './types/git'; 

interface Item extends vscode.QuickPickItem {
  /** Git information about the changes in a particular file. */
  change: Change
}

let lastSelected: Item;
let initSelection: vscode.Selection;
let initUri: vscode.Uri;
let pick: vscode.QuickPick<Item>;
let quickPickEntries: Item[];
let api: GitAPI;

export function activate(context: vscode.ExtensionContext) {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git').exports;
  api = gitExtension.getAPI(1);

  context.subscriptions.push(vscode.commands.registerCommand('quickDiff.open', showPicker));
  pick = vscode.window.createQuickPick<Item>();

  pick.onDidChangeSelection(() => {
    const item: Item = pick.selectedItems[0];
    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    vscode.commands.executeCommand('vscode.open', item.change.uri);
    lastSelected = null;
    pick.hide();
  });

  // preview the diff as the user navigates through the list.
  pick.onDidChangeActive(items => {
    if (!items.length)  return;

    const item: Item = items[0];
    const gitUri = api.toGitUri(item.change.uri, 'HEAD');
    // Before opening a new diff clean up the old one.
    if (vscode.window.activeTextEditor.document.uri !== initUri) {
      vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
    vscode.commands.executeCommand('vscode.diff', gitUri, item.change.uri, null, { preview: true, preserveFocus: true } as vscode.TextDocumentShowOptions);
  });

  // If the picker was closed without selection navigate back to the initial location.
  pick.onDidHide(async () => {
    if (pick.selectedItems.length) return;
    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    if (!initUri) return;

    await vscode.commands.executeCommand('vscode.open', initUri);
    const editor = vscode.window.activeTextEditor;
    editor.selection = initSelection;
    editor.revealRange(
      new vscode.Range(initSelection.start, initSelection.end),
      vscode.TextEditorRevealType.InCenter
    );
  });
}

function showPicker() {
  initSelection = vscode.window.activeTextEditor?.selection;
  initUri = vscode.window.activeTextEditor?.document.uri;
  const repo = api.repositories[0];
  const changes = repo?.state.workingTreeChanges;

  if (changes?.length) {
    quickPickEntries = changes.map(change => {
      const filePath = change.uri.path;
      const rootPath = vscode.workspace.workspaceFolders[0].uri.path;
      const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
      const relativePath = filePath.slice(rootPath.length + 1, filePath.lastIndexOf('/'));
      return { label: fileName, description: relativePath, change };
    });
    pick.enabled = true;
  } else {
    quickPickEntries = [{ label: 'No unstaged Git changes detected', change: null }];
    pick.enabled = false;
  }

  pick.value = ''; // Erase previously set filter value.
  pick.items = quickPickEntries;
  pick.show();
}
