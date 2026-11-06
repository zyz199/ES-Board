package service

import (
	"app/backend/types"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestESService 构造一个未连接的 ESService（与生产入口 NewESService 一致）
func newTestESService() *ESService {
	return NewESService()
}

func TestServiceMethodsRequireConnection(t *testing.T) {
	es := newTestESService()

	cases := map[string]func() any{
		"GetHealth":     func() any { return es.GetHealth() },
		"GetNodes":      func() any { return es.GetNodes() },
		"GetStats":      func() any { return es.GetStats() },
		"GetIndexes":    func() any { return es.GetIndexes("") },
		"DeleteIndex":   func() any { return es.DeleteIndex("idx") },
		"AddDocument":   func() any { return es.AddDocument("idx", `{"a":1}`) },
		"SearchDocs":    func() any { return es.SearchDocs("idx", `{"match_all":{}}`, 0, 10) },
		"GetIndexInfo":  func() any { return es.GetIndexInfo("idx") },
		"GetSLMPolices": func() any { return es.GetSLMPolicies() },
		"GetTasks":      func() any { return es.GetTasks() },
	}

	for name, fn := range cases {
		resp := fn()
		if resp == nil {
			t.Errorf("%s: 期望返回响应，实际为 nil", name)
			continue
		}
		var gotErr string
		switch r := resp.(type) {
		case *types.ResultResp:
			gotErr = r.Err
		case *types.ResultsResp:
			gotErr = r.Err
		}
		if gotErr != "请先选择一个集群" {
			t.Errorf("%s: 未连接时期望 Err=请先选择一个集群, 实际=%q", name, gotErr)
		}
	}
}

func TestSetConnectAndRequestsOverHTTP(t *testing.T) {
	// 模拟 ES 的 /_cluster/health 接口
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cluster_name":"test","status":"green"}`))
	}))
	defer srv.Close()

	es := NewESService()
	es.SetConnect("conn-1", srv.URL, "elastic", "pass", "", false, false)

	// http 模式下请求应成功
	resp := es.GetHealth()
	if resp.Err != "" {
		t.Fatalf("GetHealth 期望成功, 实际 Err=%q", resp.Err)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok || result["cluster_name"] != "test" {
		t.Fatalf("GetHealth 结果不符合预期: %#v", resp.Result)
	}
	// BasicAuth 应随请求发送
	if !strings.HasPrefix(gotAuth, "Basic ") {
		t.Errorf("期望携带 Basic 认证头, 实际=%q", gotAuth)
	}

	// 再次 SetConnect 不带用户名密码 → 旧凭证不应残留
	es.SetConnect("conn-2", srv.URL, "", "", "", false, false)
	gotAuth = ""
	resp = es.GetHealth()
	if resp.Err != "" {
		t.Fatalf("第二次 GetHealth 期望成功, 实际 Err=%q", resp.Err)
	}
	if gotAuth != "" {
		t.Errorf("切换连接后不应残留 Basic 认证头, 实际=%q", gotAuth)
	}
}

func TestBulkImportValidation(t *testing.T) {
	es := NewESService()
	// Host 指向不可达地址即可，参数校验发生在发起请求之前
	es.SetConnect("invalid-host", "http://127.0.0.1:1", "", "", "", false, false)

	// 非 JSON 数组
	resp := es.BulkImport("idx", `{"a":1}`)
	if !strings.Contains(resp.Err, "文档数据必须是JSON数组") {
		t.Errorf("非法文档时期望提示 JSON 数组错误, 实际=%q", resp.Err)
	}

	// 空数组
	resp = es.BulkImport("idx", `[]`)
	if resp.Err != "没有可导入的文档" {
		t.Errorf("空数组时期望 Err=没有可导入的文档, 实际=%q", resp.Err)
	}
}

// fakeBulkServer 返回一个模拟 _bulk 响应的测试服务
func fakeBulkServer(t *testing.T, body string, statusCode int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_bulk" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(body))
	}))
}

func TestBulkImportAllSuccess(t *testing.T) {
	srv := fakeBulkServer(t, `{"items":[{"index":{"status":201}},{"index":{"status":201}}]}`, http.StatusOK)
	defer srv.Close()

	es := NewESService()
	es.SetConnect("t", srv.URL, "", "", "", false, false)

	resp := es.BulkImport("my-index", `[{"name":"a"},{"name":"b"}]`)
	if resp.Err != "" {
		t.Fatalf("期望导入成功, 实际 Err=%q", resp.Err)
	}
	summary, ok := resp.Result.(types.H)
	if !ok {
		t.Fatalf("期望返回汇总 map, 实际=%#v", resp.Result)
	}
	if summary["total"] != 2 || summary["success"] != 2 || summary["failed"] != 0 {
		t.Errorf("汇总不符预期: %#v", summary)
	}
	if _, has := summary["first_error"]; has {
		t.Errorf("全部成功时不应有 first_error: %#v", summary)
	}
}

func TestBulkImportPartialFailure(t *testing.T) {
	srv := fakeBulkServer(t, `{"items":[
		{"index":{"status":201}},
		{"index":{"status":400,"error":{"type":"mapper_parsing_exception","reason":"failed to parse"}}}
	]}`, http.StatusOK)
	defer srv.Close()

	es := NewESService()
	es.SetConnect("t", srv.URL, "", "", "", false, false)

	resp := es.BulkImport("my-index", `[{"ok":true},{"bad":"doc"}]`)
	if resp.Err != "" {
		t.Fatalf("HTTP 200 时不应整体报错, 实际 Err=%q", resp.Err)
	}
	summary := resp.Result.(types.H)
	if summary["total"] != 2 || summary["success"] != 1 || summary["failed"] != 1 {
		t.Errorf("部分失败汇总不符预期: %#v", summary)
	}
	if firstErr, _ := summary["first_error"].(string); !strings.Contains(firstErr, "mapper_parsing_exception") {
		t.Errorf("first_error 应包含首个失败原因, 实际=%q", firstErr)
	}
}

func TestBulkImportHTTPError(t *testing.T) {
	srv := fakeBulkServer(t, `{"error":"boom"}`, http.StatusInternalServerError)
	defer srv.Close()

	es := NewESService()
	es.SetConnect("t", srv.URL, "", "", "", false, false)

	resp := es.BulkImport("my-index", `[{"a":1}]`)
	if !strings.Contains(resp.Err, "boom") {
		t.Errorf("HTTP 500 时 Err 应包含响应体, 实际=%q", resp.Err)
	}
}

// --- ConfigureSSL 行为验证（通过真实 TLS 握手，而非依赖 resty 内部字段） ---

func serverCertPEM(srv *httptest.Server) string {
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	return string(certPEM)
}

func TestConfigureSSL_HTTPSWithCACert(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	es := NewESService()
	// 使用服务端证书作为 CA，且不跳过校验 → 仍应握手成功
	es.SetConnect("tls", srv.URL, "", "", serverCertPEM(srv), true, false)

	resp := es.GetHealth()
	if resp.Err != "" {
		t.Fatalf("使用 CA 证书的 HTTPS 请求应成功, 实际 Err=%q", resp.Err)
	}
}

func TestConfigureSSL_HTTPSInsecureSkipVerify(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	es := NewESService()
	// 不提供 CA，但跳过校验 → 也应握手成功
	es.SetConnect("tls-insecure", srv.URL, "", "", "", true, true)

	resp := es.GetHealth()
	if resp.Err != "" {
		t.Fatalf("跳过校验的 HTTPS 请求应成功, 实际 Err=%q", resp.Err)
	}
}

func TestConfigureSSL_HTTPSWithoutTrustFails(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	es := NewESService()
	// HTTPS 但既没有 CA 也不跳过校验 → 自签名证书应握手失败
	es.SetConnect("tls-untrusted", srv.URL, "", "", "", true, false)

	resp := es.GetHealth()
	if resp.Err == "" {
		t.Fatal("自签名证书且不跳过校验时请求应失败")
	}
}

func TestConfigureSSL_HTTPSchemeAgainstTLSServerFails(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	es := NewESService()
	// UseSSL=false → scheme 为 http，访问 https 服务应失败（验证 scheme 切换逻辑）
	es.SetConnect("scheme-check", srv.URL, "", "", "", false, false)

	resp := es.GetHealth()
	if resp.Err == "" {
		t.Fatal("http scheme 访问 https 服务端应失败")
	}
}
