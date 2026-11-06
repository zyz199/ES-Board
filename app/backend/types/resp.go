/*
 * Copyright 2025 zyz199 <zhangyz652@gmail.com>.
 * Author Github: https://github.com/zyz199
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

package types

type Tag struct {
	Name    string `json:"name"`
	TagName string `json:"tag_name"`
	Body    string `json:"body"`
}
type Config struct {
	Width    int       `json:"width"`
	Height   int       `json:"height"`
	Language string    `json:"language"`
	Theme    string    `json:"theme"`
	Connects []Connect `json:"connects"`
}
type History struct {
	Time   int    `json:"timestamp"`
	Method string `json:"method"`
	Path   string `json:"path"`
	DSL    string `json:"dsl"`
}
type ResultsResp struct {
	Results []any  `json:"results"`
	Err     string `json:"err"`
}
type ResultResp struct {
	Result any    `json:"result"`
	Err    string `json:"err"`
}
type Connect struct {
	Id            int    `json:"id"`
	Name          string `json:"name"`
	Host          string `json:"host"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	UseSSL        bool   `json:"useSSL"`
	SkipSSLVerify bool   `json:"skipSSLVerify"`
	CACert        string `json:"caCert"`
}
type H map[string]any
