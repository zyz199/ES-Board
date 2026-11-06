package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

// TestSearchBodyParamMustBeString 锁住 Search 第三个参数必须是 string。
//
// 回归背景：该参数原本是 `any`。Wails v2 在前端传 null（无 body 的 GET/HEAD/DELETE）
// 时会用零值 reflect.Value 去调用 Go 方法，直接报
// `reflect: Call using zero Value argument`，导致「开发工具」里所有无 body 的请求
// （GET /_cluster/health、GET /_cat/indices?v …）全部失败。
// 空串表示「不带 body」。改回 any 会重新引入该 bug，因此在此断言签名。
func TestSearchBodyParamMustBeString(t *testing.T) {
	m, ok := reflect.TypeOf(&ESService{}).MethodByName("Search")
	if !ok {
		t.Fatal("ESService 上找不到 Search 方法")
	}
	// In(0)=接收者, In(1)=method, In(2)=path, In(3)=body
	if got := m.Type.In(3).Kind(); got != reflect.String {
		t.Fatalf("Search 第 3 个参数必须是 string, 实际为 %v；"+
			"改回 any 会让前端传 null 时触发 Wails 的 reflect: Call using zero Value argument", got)
	}
	if n := m.Type.NumIn(); n != 4 {
		t.Fatalf("Search 参数个数应为 3（method/path/body），实际的接收者外参数个数=%d", n-1)
	}
}

// TestSearchEmptyBodySendsNoBody 空串 body 时不应带上请求体。
func TestSearchEmptyBodySendsNoBody(t *testing.T) {
	var gotBody []byte
	var gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cluster_name":"test","status":"green"}`))
	}))
	defer srv.Close()

	es := NewESService()
	es.SetConnect("c1", srv.URL, "", "", "", false, false)

	res := es.Search("GET", "/_cluster/health", "")
	if res.Err != "" {
		t.Fatalf("Search 失败: %s", res.Err)
	}
	if gotMethod != http.MethodGet {
		t.Errorf("服务端收到的方法=%q, 期望 GET", gotMethod)
	}
	if len(gotBody) != 0 {
		t.Errorf("空串 body 不应发送请求体, 实际发送了 %q", string(gotBody))
	}
	m, ok := res.Result.(map[string]any)
	if !ok {
		t.Fatalf("Result 应为 map, 实际 %T", res.Result)
	}
	if m["status"] != "green" {
		t.Errorf("status=%v, 期望 green", m["status"])
	}
}

// TestSearchSendsBodyWhenProvided 有 body 时按 JSON 原样发出。
func TestSearchSendsBodyWhenProvided(t *testing.T) {
	var gotBody []byte
	var gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotCT = r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"took":1}`))
	}))
	defer srv.Close()

	es := NewESService()
	es.SetConnect("c1", srv.URL, "", "", "", false, false)

	payload := `{"query":{"match_all":{}},"size":1}`
	res := es.Search("POST", "/_search", payload)
	if res.Err != "" {
		t.Fatalf("Search 失败: %s", res.Err)
	}
	var sent map[string]any
	if err := json.Unmarshal(gotBody, &sent); err != nil {
		t.Fatalf("服务端收到的 body 不是合法 JSON: %v（原文 %q）", err, string(gotBody))
	}
	if _, ok := sent["query"]; !ok {
		t.Errorf("body 未被正确转发: %v", sent)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type=%q, 期望 application/json（body 为 string 时不能被 resty 改成 text/plain）", gotCT)
	}
}

// TestSearchRejectsBadPath 保留路径校验行为（空/不以 / 开头/含空白）。
func TestSearchRejectsBadPath(t *testing.T) {
	es := NewESService()
	es.SetConnect("c1", "http://127.0.0.1:1", "", "", "", false, false)
	for _, p := range []string{"", "_cluster/health", "/_cluster/health x"} {
		if res := es.Search("GET", p, ""); res.Err == "" {
			t.Errorf("路径 %q 应被拒绝", p)
		}
	}
	if res := es.Search("BREW", "/_cluster/health", ""); res.Err == "" {
		t.Error("非法方法应被拒绝")
	}
}
