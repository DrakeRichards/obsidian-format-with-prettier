import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

import * as prettier from "prettier/standalone";
import * as markdownPlugin from "prettier/plugins/markdown";
import * as htmlPlugin from "prettier/plugins/html";
import * as estreePlugin from "prettier/plugins/estree";
import * as typescriptPlugin from "prettier/plugins/typescript";
import * as babelPlugin from "prettier/plugins/babel";

import {
	cursorOffsetToEditorPosition,
	editorPositionToCursorOffset,
} from "./cursor-position-utils";
import { VimWriteCommandPatcher } from "./vim-write-command-patcher";
import { PrettierConfigLoader } from "./prettier-config-loader";
import { SaveFileCommandCallback } from "./save-file-command-callback";

interface PrettierPluginSettings {
	formatOnSave: boolean;
}

const DEFAULT_SETTINGS: PrettierPluginSettings = {
	formatOnSave: true,
};

export default class PrettierPlugin extends Plugin {
	settings: PrettierPluginSettings;

	private onFileSave = () => {
		if (!this.settings.formatOnSave) {
			return;
		}

		const editor = this.getEditor();

		if (!editor) {
			return;
		}

		void this.formatFile(editor);
	};

	private readonly vimWriteCommandPatcher = new VimWriteCommandPatcher(
		this.app,
	);
	private readonly prettierConfigLoader = new PrettierConfigLoader(
		this.app,
		(ref) => {
			this.registerEvent(ref);
		},
	);
	private readonly saveFileCommandCallback = new SaveFileCommandCallback(
		this.app,
		this.onFileSave,
	);

	private getEditor(): Editor | null {
		const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (!activeLeaf) {
			return null;
		}

		return activeLeaf.editor;
	}

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PrettierSettingTab(this.app, this));

		this.addCommands();

		await this.prettierConfigLoader.onload();
		this.vimWriteCommandPatcher.onload();
		this.saveFileCommandCallback.onload();
	}

	onunload() {
		this.vimWriteCommandPatcher.onunload();
		this.saveFileCommandCallback.onunload();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as PrettierPluginSettings | null,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addCommands() {
		this.addCommand({
			id: "format-file",
			name: "Format current file",
			editorCheckCallback: (checking, editor, ctx) => {
				const file = ctx.file;

				if (!file) {
					return false;
				}

				if (checking) {
					return true;
				}

				void this.formatFile(editor);
			},
		});
	}

	private async formatFile(editor: Editor) {
		const file = this.app.workspace.getActiveFile();

		if (!file) {
			return;
		}

		const text = editor.getValue();

		try {
			console.log(this.prettierConfigLoader.getOptions());

			const {
				formatted: formattedText,
				cursorOffset: formattedTextCursorOffset,
			} = await prettier.formatWithCursor(text, {
				filepath: file.path,
				cursorOffset: editorPositionToCursorOffset(
					editor.getCursor(),
					text,
				),
				plugins: [
					markdownPlugin,
					htmlPlugin,
					estreePlugin,
					typescriptPlugin,
					babelPlugin,
				],
				...this.prettierConfigLoader.getOptions(),
			});

			editor.setValue(formattedText);
			editor.setCursor(
				cursorOffsetToEditorPosition(
					formattedTextCursorOffset,
					formattedText,
				),
			);
		} catch (e) {
			new Notice(
				"Failed to format file, see the Developer console for more details",
			);
			console.error(e);
		}
	}
}

class PrettierSettingTab extends PluginSettingTab {
	plugin: PrettierPlugin;

	constructor(app: App, plugin: PrettierPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl).setName("Format on save").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.formatOnSave)
				.onChange(async (value) => {
					this.plugin.settings.formatOnSave = value;
					await this.plugin.saveSettings();
				}),
		);
	}
}