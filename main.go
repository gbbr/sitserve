// Command sit searches the Vipassana meditation courses listed on dhamma.org.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/gbbr/sit/internal/dhamma"
)

const usage = `usage: sit <command>

commands:
  update   download the location index from dhamma.org
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	if len(os.Args) != 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "update":
		err = update(ctx)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "sit:", err)
		os.Exit(1)
	}
}

// update rebuilds the cached index from dhamma.org.
func update(ctx context.Context) error {
	idx, err := dhamma.FetchIndex(ctx, &http.Client{Timeout: 30 * time.Second})
	if err != nil {
		return err
	}
	path, err := indexPath()
	if err != nil {
		return err
	}
	if err := idx.Save(path); err != nil {
		return err
	}
	centers := 0
	for _, l := range idx.Locations {
		if l.Center {
			centers++
		}
	}
	fmt.Printf("Saved %d locations (%d centers) and %d searchable places to %s\n",
		len(idx.Locations), centers, len(idx.Places), path)
	return nil
}

// indexPath returns where the index is cached: sit/index.json in the user's
// cache directory (~/Library/Caches on macOS, $XDG_CACHE_HOME or ~/.cache on Linux).
func indexPath() (string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "sit", "index.json"), nil
}
