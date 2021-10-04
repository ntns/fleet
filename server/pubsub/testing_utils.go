package pubsub

import (
	"testing"

	"github.com/fleetdm/fleet/v4/server/datastore/redis/redistest"
)

func SetupRedisForTest(t *testing.T, cluster bool) *redisQueryResults {
	const dupResults = false
	pool := redistest.SetupRedis(t, cluster, false)
	store := NewRedisQueryResults(pool, dupResults)
	return store
}
