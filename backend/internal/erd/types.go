package erd

import "time"

type Response struct {
	GeneratedAt time.Time     `json:"generated_at"`
	Databases   []DatabaseSum `json:"databases"`
	Groups      []Group       `json:"groups"`
	Nodes       []Node        `json:"nodes"`
	Edges       []Edge        `json:"edges"`
}

type DatabaseSum struct {
	Name       string `json:"name"`
	TableCount int    `json:"table_count"`
	FKCount    int    `json:"fk_count"`
}

type Group struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Source string `json:"source"`
}

type Node struct {
	ID       string   `json:"id"`
	Database string   `json:"database"`
	Table    string   `json:"table"`
	Group    string   `json:"group"`
	RowCount int64    `json:"row_count"`
	Columns  []Column `json:"columns"`
}

type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	IsPK     bool   `json:"is_pk"`
	IsFK     bool   `json:"is_fk"`
	Nullable bool   `json:"nullable"`
}

type Edge struct {
	ID         string `json:"id"`
	From       string `json:"from"`
	To         string `json:"to"`
	FromColumn string `json:"from_column,omitempty"`
	ToColumn   string `json:"to_column,omitempty"`
	Kind       string `json:"kind"`
	OnDelete   string `json:"on_delete,omitempty"`
	Evidence   string `json:"evidence,omitempty"`
}
