/*
 * Copyright 2025 Bronya0 <tangssst@163.com>.
 * Author Github: https://github.com/Bronya0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package system

import (
	"app/backend/common"
	"app/backend/types"
	"context"
	"fmt"
	"github.com/go-resty/resty/v2"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

type Update struct {
	ctx context.Context
}

func (obj *Update) Start(ctx context.Context) {
	obj.ctx = ctx
}
func (obj *Update) CheckUpdate() *types.Tag {
	// 必须设超时：GitHub 不可达时无超时会挂起数分钟，阻塞前端「检查更新」
	client := resty.New().SetTimeout(10 * time.Second)
	tag := &types.Tag{}
	resp, err := client.R().SetResult(tag).Get(common.UPDATE_URL)
	if err != nil || resp.StatusCode() != 200 {
		return nil
	}
	tag.TagName = strings.TrimSpace(tag.TagName)
	return tag
}

func (obj *Update) GetProcessInfo() string {
	// 获取内存统计信息
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	// 获取构建信息
	var goVersion string
	if buildInfo, ok := debug.ReadBuildInfo(); ok {
		goVersion = buildInfo.GoVersion
	} else {
		goVersion = runtime.Version()
	}

	// 格式化输出详细信息
	info := fmt.Sprintf(
		"基本信息:\n"+
			"- Go版本: %s\n"+
			"- 操作系统: %s\n"+
			"- 体系结构: %s\n"+
			"- CPU数量: %d\n"+
			"- 协程数量: %d\n"+
			"- 当前时间戳: %s\n\n"+
			"内存统计:\n"+
			"- 已分配内存: %.2f MB\n"+
			"- 总分配内存: %.2f MB\n"+
			"- 系统内存: %.2f MB\n"+
			"- 堆分配: %.2f MB\n"+
			"- 堆系统内存: %.2f MB\n"+
			"- 堆空闲: %.2f MB\n"+
			"- 堆使用中: %.2f MB\n"+
			"- 栈使用中: %.2f MB\n"+
			"- 堆对象数量: %d\n"+
			"- 内存分配次数: %d\n"+
			"- 内存释放次数: %d\n\n"+
			"垃圾回收统计:\n"+
			"- 垃圾回收运行次数: %d\n"+
			"- 上次垃圾回收时间: %s\n"+
			"- 下次垃圾回收限制: %.2f MB\n"+
			"- 垃圾回收CPU占比: %.4f%%\n"+
			"- 垃圾回收总暂停时间: %v\n",
		goVersion,                        // Go版本
		runtime.GOOS,                     // 操作系统
		runtime.GOARCH,                   // 体系结构
		runtime.NumCPU(),                 // CPU数量
		runtime.NumGoroutine(),           // 协程数量
		time.Now().Format(time.DateTime), // 当前时间戳

		float64(memStats.Alloc)/1024/1024,      // 已分配内存
		float64(memStats.TotalAlloc)/1024/1024, // 总分配内存
		float64(memStats.Sys)/1024/1024,        // 系统内存
		float64(memStats.HeapAlloc)/1024/1024,  // 堆分配
		float64(memStats.HeapSys)/1024/1024,    // 堆系统内存
		float64(memStats.HeapIdle)/1024/1024,   // 堆空闲
		float64(memStats.HeapInuse)/1024/1024,  // 堆使用中
		float64(memStats.StackInuse)/1024/1024, // 栈使用中
		memStats.HeapObjects,                   // 堆对象数量
		memStats.Mallocs,                       // 内存分配次数
		memStats.Frees,                         // 内存释放次数

		memStats.NumGC, // 垃圾回收运行次数
		time.Unix(0, int64(memStats.LastGC)).Format(time.DateTime), // 上次垃圾回收时间
		float64(memStats.NextGC)/1024/1024,                         // 下次垃圾回收限制
		memStats.GCCPUFraction*100,                                 // 垃圾回收CPU占比
		time.Duration(memStats.PauseTotalNs),                       // 垃圾回收总暂停时间
	)

	return info
}
