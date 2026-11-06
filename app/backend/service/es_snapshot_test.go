package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// --- 连接快照（atomic.Pointer）行为验证 ---

func TestSnapshotAccessors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cluster_name":"test"}`))
	}))
	defer srv.Close()

	es := NewESService()
	// 未连接时 hostName 应为空
	if h := es.hostName(); h != "" {
		t.Errorf("未连接时期望 hostName 为空, 实际=%q", h)
	}

	es.SetConnect("c1", srv.URL, "", "", "", false, false)

	client, host := es.current()
	if host != srv.URL {
		t.Errorf("current() host=%q, 期望 %q", host, srv.URL)
	}
	if client == nil {
		t.Fatal("current() client 不应为 nil")
	}
	if es.hostName() != srv.URL {
		t.Errorf("hostName()=%q, 期望 %q", es.hostName(), srv.URL)
	}
	if es.httpClient() != client {
		t.Error("httpClient() 与 current() 返回的应是同一个 client 快照")
	}
}

// TestConcurrentSwitchAndRequests 并发切换连接的同时持续发请求。
// 本测试主要价值在于 go test -race 下验证无数据竞争：
// 请求侧拿到的 (client, host) 可能来自任意一代连接，但两台服务端都能正常应答，
// 因此任何一代快照组合都应请求成功。
func TestConcurrentSwitchAndRequests(t *testing.T) {
	newSrv := func(name string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"cluster_name":"` + name + `"}`))
		}))
	}
	srv1 := newSrv("one")
	defer srv1.Close()
	srv2 := newSrv("two")
	defer srv2.Close()

	es := NewESService()

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// 切换者：反复重建 client + conn
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			es.SetConnect("a", srv1.URL, "", "", "", false, false)
			es.SetConnect("b", srv2.URL, "", "", "", false, false)
		}
		close(stop)
	}()

	// 请求者：不停发请求
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				if h := es.hostName(); h != "" {
					// 无论拿到哪一代快照，都应能正常完成请求
					if resp := es.GetHealth(); resp.Err != "" {
						t.Errorf("并发切换期间 GetHealth 不应失败: %q", resp.Err)
						return
					}
				}
			}
		}()
	}

	wg.Wait()
}

// --- indexName 转义（url.PathEscape）验证 ---

func TestIndexNamePathEscape(t *testing.T) {
	var gotPath string
	var gotDecoded string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		gotDecoded = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	es := NewESService()
	es.SetConnect("t", srv.URL, "", "", "", false, false)

	// 空格 / 斜杠 / # / ? 都应被转义（不会被当成路径分隔或截断）
	if resp := es.GetIndexInfo(`my index/2024#frag?x`); resp.Err != "" {
		t.Fatalf("GetIndexInfo 期望成功, 实际 Err=%q", resp.Err)
	}
	if gotPath != `/my%20index%2F2024%23frag%3Fx` {
		t.Errorf("特殊字符索引名应被 PathEscape 转义, 实际路径=%q", gotPath)
	}
	if gotDecoded != "/my index/2024#frag?x" {
		t.Errorf("服务端解码后应还原为原始索引名, 实际=%q", gotDecoded)
	}

	// 通配符/逗号列表：无论线上编码形态如何，服务端解码后必须还原原始名称
	gotPath, gotDecoded = "", ""
	if resp := es.DeleteIndex(`a,b*c`); resp.Err != "" {
		t.Fatalf("DeleteIndex 期望成功, 实际 Err=%q", resp.Err)
	}
	if gotDecoded != "/a,b*c" {
		t.Errorf("通配符/逗号索引名解码后应还原原始名称, 实际=%q (线上=%q)", gotDecoded, gotPath)
	}
}

// --- TestClient（独立短超时连接测试入口） ---

func TestTestClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cluster_name":"ok"}`))
	}))
	defer srv.Close()

	es := NewESService()
	if msg := es.TestClient(srv.URL, "", "", "", false, false); msg != "" {
		t.Errorf("健康服务端 TestClient 应返回空串, 实际=%q", msg)
	}
	if msg := es.TestClient("http://127.0.0.1:1", "", "", "", false, false); msg == "" {
		t.Error("不可达地址 TestClient 应返回错误信息")
	}
}

// --- GetSnapshots 错误收集（部分失败保留结果 / 全部失败返回错误） ---

func snapshotRepoServer(t *testing.T, reposJSON string, repoHandler func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/_snapshot", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reposJSON))
	})
	mux.HandleFunc("/_snapshot/", repoHandler)
	return httptest.NewServer(mux)
}

func TestGetSnapshotsPartialFailure(t *testing.T) {
	srv := snapshotRepoServer(t, `{"repo_ok":{},"repo_bad":{}}`,
		func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if strings.Contains(r.URL.Path, "/repo_bad/") {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"boom"}`))
				return
			}
			_, _ = w.Write([]byte(`{"snapshots":[
				{"snapshot":"snap-1","state":"success","start_time":"t0","end_time":"t1",
				 "indices":["i1"],"shards":{"total":5,"successful":5}}
			]}`))
		})
	defer srv.Close()

	es := NewESService()
	es.SetConnect("t", srv.URL, "", "", "", false, false)

	resp := es.GetSnapshots()
	if resp.Err != "" {
		t.Fatalf("部分仓库失败时不应整体报错, 实际 Err=%q", resp.Err)
	}
	if len(resp.Results) != 1 {
		t.Fatalf("成功仓库的快照应保留, 实际=%#v", resp.Results)
	}
	snap, ok := resp.Results[0].(map[string]any)
	if !ok || snap["snapshot"] != "snap-1" || snap["repository"] != "repo_ok" {
		t.Errorf("快照内容不符预期: %#v", resp.Results)
	}
	if snap["state"] != "SUCCESS" {
		t.Errorf("state 应统一转大写, 实际=%v", snap["state"])
	}
	if snap["total_shards"] != float64(5) {
		t.Errorf("total_shards 应为 5, 实际=%v", snap["total_shards"])
	}
}

func TestGetSnapshotsAllFail(t *testing.T) {
	srv := snapshotRepoServer(t, `{"repo_a":{},"repo_b":{}}`,
		func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"boom"}`))
		})
	defer srv.Close()

	es := NewESService()
	es.SetConnect("t", srv.URL, "", "", "", false, false)

	resp := es.GetSnapshots()
	// 全部失败时应返回收集到的错误，而不是空结果
	if resp.Err == "" {
		t.Fatal("全部仓库失败时应返回错误")
	}
	if !strings.Contains(resp.Err, "repo_a") || !strings.Contains(resp.Err, "repo_b") {
		t.Errorf("错误信息应包含每个失败仓库的详情, 实际=%q", resp.Err)
	}
}
