# 拾忆卡 macOS 跨应用划词

这个伴侣程序让拾忆卡不再局限于网页：在 Codex、备忘录、飞书等支持 macOS 辅助功能文本选择的应用中选中文字，鼠标旁会出现“学习”。点击后内容进入本地待同步队列，Chrome 扩展会在一分钟内导入同一个知识库。

## 工作方式

1. 常驻菜单栏程序通过 macOS Accessibility API 读取当前选中文字。
2. 点击“学习”后写入 `~/Library/Application Support/ShiyiCard/pending.json`。
3. Chrome 扩展通过 Native Messaging 每分钟拉取新知识，成功保存后确认并清除队列。
4. 所有数据只在本机传递。

## 构建与安装

```bash
./build.sh
./install.sh
```

首次启动会请求“辅助功能”权限。授权后重新打开“拾忆卡”。菜单栏的“忆”图标可以暂停划词捕获或退出。

默认绑定当前未打包扩展 ID `lkpicpmpkngebhgahhanngoglckfhija`。如果 Chrome 重新安装扩展后 ID 改变，安装时传入新的 ID：

```bash
EXTENSION_ID=新的扩展ID ./install.sh
```
