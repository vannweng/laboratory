---
name: 生活實驗室
description: 個人生活練習作品的簡約目錄
colors:
  paper: "#f1f3ef"
  ink: "#253f34"
  muted: "#465c4c"
  rule: "#bfc5b8"
  strong-rule: "#6e8172"
  accent: "#a54b30"
  field: "#fbf8ee"
  badge: "#e8e5dc"
typography:
  display:
    fontFamily: "Noto Serif TC, Songti TC, PMingLiU, serif"
    fontWeight: 600
  body:
    fontFamily: "Noto Sans TC, system-ui, sans-serif"
rounded:
  compact: "2px"
  icon: "3px"
  pill: "30px"
spacing:
  compact: "12px"
  section: "48px"
---

# Design System: 生活實驗室

## Overview

**Creative North Star: "The Quiet Index"**

首頁像一本持續更新的生活索引：溫暖紙面、深綠文字與細緻分隔線，讓每個作品以一列清楚的資料被閱讀。介面以排版和間距建立層次，沒有照片或裝飾性插畫。

## Colors

紙色背景與墨綠文字是主要閱讀關係；陶土橘只用於互動焦點與細小提示。

## Typography

標題使用 Noto Serif TC，正文使用 Noto Sans TC。標題有清楚而克制的尺寸階級，正文保持舒適的行高與對比。

## Layout

內容寬度上限為 920px，首頁由短介紹與單欄作品索引組成。桌面與手機皆保留單欄作品清單；手機只縮小邊距與字級，不改變閱讀順序。

## Elevation & Depth

維持扁平表面。層次由分隔線、背景色和懸停狀態表達，不使用常態陰影。

## Shapes

以直線與 1px 細線為主；狀態標籤可使用極小圓角。控制元件保留既有可辨識的圓角和焦點外框。

## Components

### Project rows

每一列依序呈現圖示、作品名稱、狀態、簡短說明、進入連結與筆記按鈕。整列懸停時只改變背景，保留乾淨的目錄感。

### Navigation

頂端導覽使用細分隔線，主題切換維持明確按鈕尺寸與鍵盤焦點。

## Do's and Don'ts

- Do：以留白、細線和字級建立層次。
- Do：在亮暗模式中維持足夠的文字與邊界對比。
- Don't：在首頁使用照片、插畫或大面積色塊。
- Don't：把作品清單重新包裝成卡片格狀版面。
