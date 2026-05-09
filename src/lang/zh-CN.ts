/**
 * 简体中文翻译 - Simplified Chinese translations for Obsidian Copilot
 */
export default {
  // 聊天界面
  chat: {
    newChat: "新对话",
    send: "发送",
    sendMessage: "发送消息",
    stopGenerating: "停止生成",
    dropFilesHere: "将文件拖放到这里...",
    saveAsNote: "保存为笔记",
    copy: "复制",
    delete: "删除",
    cancel: "取消",
    confirm: "确认",
    regenerate: "重新生成",
    edit: "编辑",
    untitledConversation: "未命名对话",
    noResults: "无结果",
    loadingModels: "正在加载模型...",
  },

  // 消息
  messages: {
    messageNotFound: "未找到消息。",
    cannotRegenerateFirst: "无法重新生成第一条消息。",
    failedToSend: "发送消息失败，请重试。",
    failedToRegenerate: "重新生成消息失败，请重试。",
    failedToEdit: "编辑消息失败，请重试。",
    failedToDelete: "删除消息失败，请重试。",
    failedToRegenerateAI: "重新生成 AI 回复失败，请重试。",
    failedToSave: "保存对话为笔记失败，请查看控制台了解详情。",
    failedToLoadHistory: "加载对话历史失败。",
    failedToUpdateTitle: "更新对话标题失败。",
    failedToDeleteChat: "删除对话失败。",
    failedToLoadChat: "加载对话失败。",
    failedToOpenSource: "打开源文件失败。",
  },

  // 加载状态
  loading: {
    default: "",
    readingFiles: "正在读取文件",
    searchingWeb: "正在搜索网络",
    readingFileTree: "正在读取文件树",
    compacting: "正在压缩",
  },

  // 项目
  project: {
    add: "添加项目",
    edit: "编辑项目",
    delete: "删除项目",
    projectAdded: "添加成功",
    projectUpdated: "更新成功",
    projectAddedContextLoaded: "已添加并加载上下文",
    projectUpdatedContextReloaded: "已更新并重新加载上下文",
    projectAddedContextFailed: "已添加但上下文加载失败",
    projectUpdatedContextFailed: "已更新但上下文重新加载失败",
    projectAlreadyExists: "项目 \"{{name}}\" 已存在，请使用不同的名称",
    projectDoesNotExist: "不存在",
  },

  // 模型
  model: {
    selectModel: "选择模型",
    addModel: "添加模型",
    unknownModel: "未知模型",
    noActiveModel: "未配置活动模型。请在 Copilot 设置中配置模型。",
    noModelKey: "未找到模型密钥。请在设置中选择模型。",
  },

  // 设置
  settings: {
    title: "Copilot 设置",
    reload: "重新加载插件",
    reloadSuccess: "插件重新加载成功。",
    reloadFailed: "插件重新加载失败，请手动重新加载。",
    testFailed: "测试操作失败",
    invalidLicense: "无效的许可证密钥",
  },

  // 错误
  errors: {
    inputValidationFailed: "输入验证失败",
    invalidInput: "无效输入",
    invalidOperation: "无效操作",
    networkFailed: "网络请求失败",
    failedFetch: "获取失败",
    failedLoadContent: "加载内容失败",
    failedCopyClipboard: "复制到剪贴板失败",
    pleaseFillRequired: "请填写所有必填字段",
  },

  // 工具
  tools: {
    webSearch: "网络搜索",
    vaultSearch: "库搜索",
    activeNote: "当前笔记",
    ignoreFiles: "忽略文件",
    forceReindex: "强制重新索引库",
  },

  // Copilot Plus
  plus: {
    copilotPlus: "Copilot Plus",
  },

  // 其他
  misc: {
    none: "无（使用内置提示）",
    noCustomPrompts: "未找到自定义提示文件。",
    noRelevantDocs: "未找到相关文档。",
  },
};
