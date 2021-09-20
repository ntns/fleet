package mysql

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/fleetdm/fleet/v4/server/fleet"
	"github.com/jmoiron/sqlx"
	"github.com/pkg/errors"
)

func (ds *Datastore) NewGlobalPolicy(ctx context.Context, queryID uint) (*fleet.Policy, error) {
	res, err := ds.writer.ExecContext(ctx, `INSERT INTO policies (query_id) VALUES (?)`, queryID)
	if err != nil {
		return nil, errors.Wrap(err, "inserting new policy")
	}
	lastIdInt64, err := res.LastInsertId()
	if err != nil {
		return nil, errors.Wrap(err, "getting last id after inserting policy")
	}

	return policyDB(ctx, ds.writer, uint(lastIdInt64), nil)
}

func (ds *Datastore) Policy(ctx context.Context, id uint) (*fleet.Policy, error) {
	return policyDB(ctx, ds.reader, id, nil)
}

func policyDB(ctx context.Context, q sqlx.QueryerContext, id uint, teamID *uint) (*fleet.Policy, error) {
	teamWhere := "TRUE"
	args := []interface{}{id}
	if teamID != nil {
		teamWhere = "team_id = ?"
		args = append(args, *teamID)
	}

	var policy fleet.Policy
	err := sqlx.GetContext(ctx, q, &policy,
		fmt.Sprintf(`SELECT
       		p.*,
       		q.name as query_name,
       		(select count(*) from policy_membership where policy_id=p.id and passes=true) as passing_host_count,
       		(select count(*) from policy_membership where policy_id=p.id and passes=false) as failing_host_count
		FROM policies p JOIN queries q ON (p.query_id=q.id) WHERE p.id=? AND %s`, teamWhere),
		args...)
	if err != nil {
		return nil, errors.Wrap(err, "getting policy")
	}
	return &policy, nil
}

func (ds *Datastore) RecordPolicyQueryExecutions(ctx context.Context, host *fleet.Host, results map[uint]*bool, updated time.Time) error {
	// Sort the results to have generated SQL queries ordered to minimize
	// deadlocks. See https://github.com/fleetdm/fleet/issues/1146.
	orderedIDs := make([]uint, 0, len(results))
	for policyID := range results {
		orderedIDs = append(orderedIDs, policyID)
	}
	sort.Slice(orderedIDs, func(i, j int) bool { return orderedIDs[i] < orderedIDs[j] })

	// Loop through results, collecting which labels we need to insert/update
	vals := []interface{}{}
	bindvars := []string{}
	for _, policyID := range orderedIDs {
		matches := results[policyID]
		bindvars = append(bindvars, "(?,?,?,?)")
		vals = append(vals, updated, policyID, host.ID, matches)
	}

	query := fmt.Sprintf(
		`INSERT INTO policy_membership_history (updated_at, policy_id, host_id, passes)
				VALUES %s`,
		strings.Join(bindvars, ","),
	)

	_, err := ds.writer.ExecContext(ctx, query, vals...)
	if err != nil {
		return errors.Wrapf(err, "insert policy_membership (%v)", vals)
	}

	return nil
}

func (ds *Datastore) ListGlobalPolicies(ctx context.Context) ([]*fleet.Policy, error) {
	return listPoliciesDB(ctx, ds.reader, nil)
}

func listPoliciesDB(ctx context.Context, q sqlx.QueryerContext, teamID *uint) ([]*fleet.Policy, error) {
	teamWhere := "p.team_id is NULL"
	var args []interface{}
	if teamID != nil {
		teamWhere = "p.team_id = ?"
		args = append(args, *teamID)
	}
	var policies []*fleet.Policy
	err := sqlx.SelectContext(
		ctx,
		q,
		&policies,
		fmt.Sprintf(`SELECT
       		p.*,
       		q.name as query_name,
       		(select count(*) from policy_membership where policy_id=p.id and passes=true) as passing_host_count,
       		(select count(*) from policy_membership where policy_id=p.id and passes=false) as failing_host_count
		FROM policies p JOIN queries q ON (p.query_id=q.id) WHERE %s`, teamWhere), args...,
	)
	if err != nil {
		return nil, errors.Wrap(err, "listing policies")
	}
	return policies, nil
}

func (ds *Datastore) DeleteGlobalPolicies(ctx context.Context, ids []uint) ([]uint, error) {
	return deletePolicyDB(ctx, ds.writer, ids, nil)
}

func deletePolicyDB(ctx context.Context, q sqlx.ExtContext, ids []uint, teamID *uint) ([]uint, error) {
	stmt := `DELETE FROM policies WHERE id IN (?) AND %s`
	stmt, args, err := sqlx.In(stmt, ids)
	if err != nil {
		return nil, errors.Wrap(err, "IN for DELETE FROM policies")
	}
	stmt = q.Rebind(stmt)

	teamWhere := "TRUE"
	if teamID != nil {
		teamWhere = "team_id = ?"
		args = append(args, *teamID)
	}

	if _, err := q.ExecContext(ctx, fmt.Sprintf(stmt, teamWhere), args...); err != nil {
		return nil, errors.Wrap(err, "delete policies")
	}
	return ids, nil
}

func (ds *Datastore) PolicyQueriesForHost(ctx context.Context, host *fleet.Host) (map[string]string, error) {
	var globalRows, teamRows []struct {
		Id    string `db:"id"`
		Query string `db:"query"`
	}
	err := sqlx.SelectContext(
		ctx,
		ds.reader,
		&globalRows,
		`SELECT p.id, q.query FROM policies p JOIN queries q ON (p.query_id=q.id) WHERE team_id is NULL`,
	)
	if err != nil {
		return nil, errors.Wrap(err, "selecting policies for host")
	}

	results := map[string]string{}

	if host.TeamID != nil {
		err := sqlx.SelectContext(
			ctx,
			ds.reader,
			&teamRows,
			`SELECT p.id, q.query FROM policies p JOIN queries q ON (p.query_id=q.id) WHERE team_id = ?`,
			*host.TeamID,
		)
		if err != nil {
			return nil, errors.Wrap(err, "selecting policies for host in team")
		}
	}

	for _, row := range globalRows {
		results[row.Id] = row.Query
	}

	for _, row := range teamRows {
		results[row.Id] = row.Query
	}

	return results, nil
}

func (ds *Datastore) NewTeamPolicy(ctx context.Context, teamID uint, queryID uint) (*fleet.Policy, error) {
	res, err := ds.writer.ExecContext(ctx, `INSERT INTO policies (query_id, team_id) VALUES (?, ?)`, queryID, teamID)
	if err != nil {
		return nil, errors.Wrap(err, "inserting new team policy")
	}
	lastIdInt64, err := res.LastInsertId()
	if err != nil {
		return nil, errors.Wrap(err, "getting last id after inserting policy")
	}

	return policyDB(ctx, ds.writer, uint(lastIdInt64), nil)
}

func (ds *Datastore) ListTeamPolicies(ctx context.Context, teamID uint) ([]*fleet.Policy, error) {
	return listPoliciesDB(ctx, ds.reader, &teamID)
}

func (ds *Datastore) DeleteTeamPolicies(ctx context.Context, teamID uint, ids []uint) ([]uint, error) {
	return deletePolicyDB(ctx, ds.writer, ids, &teamID)
}

func (ds *Datastore) TeamPolicy(ctx context.Context, teamID uint, policyID uint) (*fleet.Policy, error) {
	return policyDB(ctx, ds.reader, policyID, &teamID)
}