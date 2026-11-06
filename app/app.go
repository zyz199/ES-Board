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

package main

import (
	"app/backend/common"
	"context"
	"crypto/tls"
	"fmt"
	"github.com/go-resty/resty/v2"
	"log"
	"runtime"
	"runtime/debug"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// Start is called at application startup
func (a *App) Start(ctx context.Context) {
	a.ctx = ctx
	log.Println("===注意，接下来前端执行onMounted，后端初始化必须在此处完成===")
}

// domReady is called after front-end resources have been loaded
func (a *App) domReady(ctx context.Context) {
	log.Println("===最后一步，页面即将显示……可以执行后端异步任务===")

	// 统计版本使用情况
	go func() {
		defer func() {
			if err := recover(); err != nil {
				fmt.Println(string(debug.Stack()))
			}
		}()
		client := resty.New().SetTLSClientConfig(&tls.Config{InsecureSkipVerify: true})
		body := map[string]any{
			"name":     common.AppName,
			"version":  common.Version,
			"platform": runtime.GOOS,
		}
		_, _ = client.R().SetBody(body).Post(common.PingUrl)
	}()
}

// beforeClose is called when the application is about to quit,
// either by clicking the window close button or calling runtime.Quit.
// Returning true will cause the application to continue, false will continue shutdown as normal.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	return false
}

// shutdown is called at application termination
func (a *App) shutdown(ctx context.Context) {
	// Perform your teardown here
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
