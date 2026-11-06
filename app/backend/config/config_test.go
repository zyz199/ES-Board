package config

import (
	"app/backend/common"
	"app/backend/types"
	"os"
	"testing"
)

// newTestConfig 返回使用临时 HOME 目录的 AppConfig，
// 避免测试读写用户真实的 ~/.es-board 配置
func newTestConfig(t *testing.T) *AppConfig {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	return &AppConfig{}
}

func TestGetConfigDefaultWhenFileMissing(t *testing.T) {
	cfg := newTestConfig(t)

	got := cfg.GetConfig()
	if got == nil {
		t.Fatal("无配置文件时应返回默认配置, 实际为 nil")
	}
	if got.Language != common.Language {
		t.Errorf("默认 Language=%q, 期望 %q", got.Language, common.Language)
	}
	if got.Theme != common.Theme {
		t.Errorf("默认 Theme=%q, 期望 %q", got.Theme, common.Theme)
	}
	if got.Width != common.Width || got.Height != common.Height {
		t.Errorf("默认窗口尺寸 %dx%d, 期望 %dx%d", got.Width, got.Height, common.Width, common.Height)
	}
	if got.Connects == nil || len(got.Connects) != 0 {
		t.Errorf("默认 Connects 应为空切片, 实际=%#v", got.Connects)
	}
}

func TestConfigSaveAndLoadRoundTrip(t *testing.T) {
	cfg := newTestConfig(t)

	saved := &types.Config{
		Width:    1280,
		Height:   800,
		Language: "en",
		Theme:    "light",
		Connects: []types.Connect{
			{Id: 1, Name: "dev", Host: "http://localhost:9200", Username: "elastic", Password: "secret", UseSSL: true, SkipSSLVerify: true},
			{Id: 2, Name: "prod", Host: "https://es.prod:9200"},
		},
	}

	if msg := cfg.SaveConfig(saved); msg != "" {
		t.Fatalf("SaveConfig 应成功, 实际返回错误: %q", msg)
	}

	loaded := cfg.GetConfig()
	if loaded.Width != 1280 || loaded.Height != 800 {
		t.Errorf("窗口尺寸未正确持久化: %dx%d", loaded.Width, loaded.Height)
	}
	if loaded.Language != "en" || loaded.Theme != "light" {
		t.Errorf("语言/主题未正确持久化: lang=%q theme=%q", loaded.Language, loaded.Theme)
	}
	if len(loaded.Connects) != 2 {
		t.Fatalf("连接数量不符: 期望 2, 实际 %d", len(loaded.Connects))
	}
	c := loaded.Connects[0]
	if c.Name != "dev" || c.Host != "http://localhost:9200" || c.Username != "elastic" || c.Password != "secret" ||
		!c.UseSSL || !c.SkipSSLVerify {
		t.Errorf("第一个连接未正确持久化: %#v", c)
	}
	if loaded.Connects[1].Name != "prod" {
		t.Errorf("第二个连接未正确持久化: %#v", loaded.Connects[1])
	}
}

func TestSaveTheme(t *testing.T) {
	cfg := newTestConfig(t)

	if msg := cfg.SaveTheme("dark"); msg != "" {
		t.Fatalf("SaveTheme 应成功, 实际返回错误: %q", msg)
	}

	// 先保存一份包含连接的配置，再改主题，确认主题更新不丢数据
	saved := &types.Config{Language: "zh-CN", Theme: "light",
		Connects: []types.Connect{{Id: 9, Name: "keep", Host: "http://h:9200"}}}
	_ = cfg.SaveConfig(saved)

	if msg := cfg.SaveTheme("dark"); msg != "" {
		t.Fatalf("SaveTheme 应成功, 实际返回错误: %q", msg)
	}
	loaded := cfg.GetConfig()
	if loaded.Theme != "dark" {
		t.Errorf("主题应为 dark, 实际 %q", loaded.Theme)
	}
	if len(loaded.Connects) != 1 || loaded.Connects[0].Name != "keep" {
		t.Errorf("改主题不应影响其他配置: %#v", loaded.Connects)
	}
}

func TestHistorySaveAndLoad(t *testing.T) {
	cfg := newTestConfig(t)

	// 空历史
	if hist := cfg.GetHistory(); len(hist) != 0 {
		t.Errorf("无历史文件时应返回空列表, 实际=%#v", hist)
	}

	saved := []types.History{
		{Time: 1730000000, Method: "GET", Path: "/_search", DSL: `{"query":{"match_all":{}}}`},
		{Time: 1730000001, Method: "POST", Path: "/idx/_bulk", DSL: ""},
	}
	if msg := cfg.SaveHistory(saved); msg != "" {
		t.Fatalf("SaveHistory 应成功, 实际返回错误: %q", msg)
	}

	loaded := cfg.GetHistory()
	if len(loaded) != 2 {
		t.Fatalf("历史数量不符: 期望 2, 实际 %d", len(loaded))
	}
	if loaded[0].Method != "GET" || loaded[0].Path != "/_search" || loaded[0].Time != 1730000000 {
		t.Errorf("第一条历史未正确持久化: %#v", loaded[0])
	}
	if loaded[1].Method != "POST" {
		t.Errorf("第二条历史未正确持久化: %#v", loaded[1])
	}
}

func TestConfigFileIsolateFromRealHome(t *testing.T) {
	cfg := newTestConfig(t)

	// 确认写入落在临时 HOME 下的 .es-board 目录，而不是真实用户目录
	saved := &types.Config{Theme: "test-isolated"}
	if msg := cfg.SaveConfig(saved); msg != "" {
		t.Fatalf("SaveConfig 应成功: %q", msg)
	}
	// GetConfig 能读到刚写的数据即证明路径隔离生效（真实 HOME 一般不会有 theme=test-isolated）
	if got := cfg.GetConfig(); got.Theme != "test-isolated" {
		t.Errorf("读取到的 Theme=%q, 期望 test-isolated", got.Theme)
	}
}

func TestSaveConfigAtomicWrite(t *testing.T) {
	cfg := newTestConfig(t)

	saved := &types.Config{Theme: "atomic", Connects: []types.Connect{{Id: 1, Name: "dev"}}}
	if msg := cfg.SaveConfig(saved); msg != "" {
		t.Fatalf("SaveConfig 应成功: %q", msg)
	}

	path := cfg.getConfigPath()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("配置文件应存在: %v", err)
	}
	// 配置含集群账号密码，权限应为 0600
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("配置文件权限应为 0600, 实际=%v", perm)
	}
	// 「写临时文件 + rename」成功后不应残留 .tmp
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("保存成功后不应残留临时文件 %s.tmp", path)
	}
}

func TestGetConfigCorruptedFileFallsBackToDefault(t *testing.T) {
	cfg := newTestConfig(t)

	// 先确保目录存在，再写入损坏的 YAML
	saved := &types.Config{Theme: "before-corruption"}
	if msg := cfg.SaveConfig(saved); msg != "" {
		t.Fatalf("SaveConfig 应成功: %q", msg)
	}
	path := cfg.getConfigPath()
	if err := os.WriteFile(path, []byte("theme: [unclosed"), 0600); err != nil {
		t.Fatalf("写入损坏配置失败: %v", err)
	}

	// 损坏文件不应导致 panic，也不应返回 nil，而应回落默认配置
	got := cfg.GetConfig()
	if got == nil {
		t.Fatal("配置文件损坏时 GetConfig 不应返回 nil")
	}
	if got.Theme != common.Theme {
		t.Errorf("配置文件损坏时应回落默认 Theme=%q, 实际=%q", common.Theme, got.Theme)
	}

	// 损坏后再正常保存，应能覆盖恢复
	if msg := cfg.SaveConfig(&types.Config{Theme: "recovered"}); msg != "" {
		t.Fatalf("损坏后 SaveConfig 应成功: %q", msg)
	}
	if got := cfg.GetConfig(); got.Theme != "recovered" {
		t.Errorf("重新保存后应读到新配置, 实际 Theme=%q", got.Theme)
	}
}
