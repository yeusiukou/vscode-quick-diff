import * as vscode from 'vscode';
import { API as GitAPI, GitExtension, Change, Status } from './types/git'; 

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

  pick.onDidChangeSelection(async () => {
    const item: Item = pick.selectedItems[0];
    if (item.change.status === Status.DELETED) {
      return;
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand('vscode.open', item.change.uri);
    
    // Navigate to the approximate location of the change.
    const diff = await api.repositories[0].diffWithHEAD(item.change.uri.path);
    const firstChangedLine = +diff.match(/(?<=@@ -)(.*?)(?=\,)/g)[0];
    const position = new vscode.Position(firstChangedLine, 0);
    jumpTo(new vscode.Selection(position, position));

    lastSelected = null;
    pick.hide();
  });

  // preview the diff as the user navigates through the list.
  pick.onDidChangeActive(items => {
    if (!items.length)  return;

    const item: Item = items[0];
    const gitUri = api.toGitUri(item.change.uri, 'HEAD');
    // Before opening a new diff clean up the old one.
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri !== initUri) {
      vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
    // if the file was deleted, there is nothing to compare. Use the same gitUri, just to be able to preview what was deleted.
    const uriAfter = item.change.status === Status.DELETED ? gitUri : item.change.uri;
    vscode.commands.executeCommand('vscode.diff', gitUri, uriAfter, null, { preview: true, preserveFocus: true } as vscode.TextDocumentShowOptions);
  });

  // If the picker was closed without selection navigate back to the initial location.
  pick.onDidHide(async () => {
    if (pick.selectedItems.length) return;
    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    if (!initUri) return;

    await vscode.commands.executeCommand('vscode.open', initUri);
    jumpTo(initSelection);
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
      const label = fileName + (change.status === Status.DELETED ? ' (Deleted)' : '');
      return { label, description: relativePath, change };
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

function jumpTo(selection: vscode.Selection) {
  const editor = vscode.window.activeTextEditor;
  editor.selection = selection;
  editor.revealRange(
    new vscode.Range(selection.start, selection.end),
    vscode.TextEditorRevealType.InCenter
  );
}
